require('dotenv').config();

const express = require('express');
const nodemailer = require('nodemailer');
const sqlite3 = require('sqlite3').verbose();
const cors = require('cors');
const puppeteer = require('puppeteer');
const stripe = require('stripe')(process.env.STRIPE_KEY);
const axios = require('axios');
const cheerio = require('cheerio');
const Diff = require('diff');

const app = express();
const port = process.env.PORT || 3000;
const host = process.env.HOST || 'localhost';

app.use(cors());

// 定义一个用于存储每个 URL 最新内容的对象
let previousContent = {};

// 创建数据库连接
const db = new sqlite3.Database(process.env.DB_PATH, async (err) => {
  if (err) {
    console.error('数据库连接失败：', err);
  } else {
    console.log('成功连接到 SQLite 数据库');
    // 直接在连接回调中初始化数据库
    db.serialize(() => {
      // 添加 read_status 和 last_change_time 列
      db.run(`
        ALTER TABLE monitoring_tasks 
        ADD COLUMN read_status INTEGER DEFAULT 0
      `, (err) => {
        if (err && !err.message.includes('duplicate column')) {
          console.error('添加 read_status 列失败:', err);
        }
      });

      db.run(`
        ALTER TABLE monitoring_tasks 
        ADD COLUMN last_change_time TIMESTAMP
      `, (err) => {
        if (err && !err.message.includes('duplicate column')) {
          console.error('添加 last_change_time 列失败:', err);
        }
      });
    });
  }
});

// 配置邮件发送
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: process.env.SMTP_PORT,
  secure: true,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS
  }
});

// 解析 JSON 格式的请求体
app.use(express.json());

// 存储所有监控任务
const monitoringTasks = new Map();

// 获取元素的唯一选择器路径
function getElementSelector(element) {
  if (!element) return null;
  
  // 如果元素有 ID，直接使用 ID
  if (element.id) {
    return `#${element.id}`;
  }
  
  // 如果元素有 class，使用 class 和标签组合
  if (element.className) {
    const classes = element.className.split(' ').join('.');
    return `${element.tagName.toLowerCase()}.${classes}`;
  }
  
  // 使用标签名和元素在同类型兄弟节点中的位置
  const index = Array.from(element.parentNode.children)
    .filter(child => child.tagName === element.tagName)
    .indexOf(element) + 1;
  
  return `${element.tagName.toLowerCase()}:nth-of-type(${index})`;
}

// 获取元素的完整选择器路径
function getElementPath(element) {
  const path = [];
  while (element && element.nodeType === 1) {
    path.unshift(getElementSelector(element));
    element = element.parentNode;
  }
  return path.join(' > ');
}

// 改进的文本对比函数
function getTextDifference(oldText, newText) {
  // 确保输入是字符串
  oldText = String(oldText || '');
  newText = String(newText || '');
  
  console.log('比对内容：');
  console.log('旧内容:', oldText);
  console.log('新内容:', newText);

  // 将文本分割成行并过滤空行
  const oldLines = oldText.split('\n')
    .map(line => line.trim())
    .filter(line => line);
  const newLines = newText.split('\n')
    .map(line => line.trim())
    .filter(line => line);

  let result = '';

  // 遍历每一行进行比较
  oldLines.forEach((oldLine, index) => {
    // 如果新文本中对应位置的行存在且不同，则记录变化
    if (newLines[index] && oldLine !== newLines[index]) {
      result += `变化行 ${index + 1}:\n原文: ${oldLine}\n新文: ${newLines[index]}\n\n`;
    }
    // 如果新文本中对应位置的行不存在，说明该行被删除
    else if (!newLines[index]) {
      result += `删除行 ${index + 1}:\n${oldLine}\n\n`;
    }
  });

  // 检查新增的行
  newLines.forEach((newLine, index) => {
    if (index >= oldLines.length) {
      result += `新增行 ${index + 1}:\n${newLine}\n\n`;
    }
  });

  return result || '未检测到差异';
}

// 计算两个字符串的相似度
function calculateSimilarity(str1, str2) {
  if (str1 === str2) return 1;
  if (!str1 || !str2) return 0;

  const len1 = str1.length;
  const len2 = str2.length;
  const matrix = Array(len1 + 1).fill().map(() => Array(len2 + 1).fill(0));

  for (let i = 0; i <= len1; i++) matrix[i][0] = i;
  for (let j = 0; j <= len2; j++) matrix[0][j] = j;

  for (let i = 1; i <= len1; i++) {
    for (let j = 1; j <= len2; j++) {
      const cost = str1[i - 1] === str2[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost
      );
    }
  }

  return 1 - (matrix[len1][len2] / Math.max(len1, len2));
}

// 改进的部分监控内容获取函数
async function getPartialContent(page, targetText) {
  return await page.evaluate((text) => {
    // 查找包含目标文本的所有元素
    const elements = Array.from(document.body.getElementsByTagName('*'));
    const matchingElement = elements.find(element => 
      element.textContent.trim().includes(text)
    );
    
    if (!matchingElement) return null;
    
    // 获取元素的位置信息
    const position = {
      xpath: getElementXPath(matchingElement),
      index: Array.from(matchingElement.parentNode.children).indexOf(matchingElement),
      parentTag: matchingElement.parentNode.tagName,
      text: matchingElement.textContent.trim()
    };
    
    // 获取元素的 XPath
    function getElementXPath(element) {
      if (!element) return '';
      if (element.id) return `//*[@id="${element.id}"]`;
      
      const sameTagSiblings = Array.from(element.parentNode.children)
        .filter(sibling => sibling.tagName === element.tagName);
      
      const index = sameTagSiblings.indexOf(element) + 1;
      const path = `${element.tagName.toLowerCase()}[${index}]`;
      
      return element.parentNode && element.parentNode.tagName
        ? `${getElementXPath(element.parentNode)}/${path}`
        : path;
    }
    
    return position;
  }, targetText);
}

// 添加获取页面内容的函数
async function getPageContent(url, monitorType, selectedContent = null) {
  let retryCount = 3;
  
  while (retryCount > 0) {
    const browser = await puppeteer.launch({
      headless: 'new',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-web-security',
        '--disable-features=IsolateOrigins,site-per-process'
      ]
    });
    
    try {
      const page = await browser.newPage();
      
      // 设置更多的浏览器选项
      await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
      await page.setExtraHTTPHeaders({
        'Accept-Language': 'zh-CN,zh;q=0.9',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8'
      });
      
      // 增加超时时间到60秒
      await page.goto(url, { 
        waitUntil: 'networkidle0', 
        timeout: 60000 
      });
      
      // 等待更长时间确保页面加载完成
      await new Promise(resolve => setTimeout(resolve, 5000));

      // 检查是否被反爬
      const content = await page.content();
      if (content.includes('验证') || content.includes('captcha')) {
        throw new Error('可能遇到反爬虫验证');
      }

      if (monitorType === 'partial' && selectedContent) {
        const result = await page.evaluate((targetText) => {
          function getTextLines() {
            const lines = [];
            const elements = document.body.getElementsByTagName('*');
            
            for (const element of elements) {
              const style = window.getComputedStyle(element);
              if (style.display === 'none' || style.visibility === 'hidden') continue;
              
              const textContent = Array.from(element.childNodes)
                .filter(node => node.nodeType === 3)
                .map(node => node.textContent.trim())
                .filter(text => text)
                .join('');
              
              if (textContent) {
                lines.push({
                  text: textContent,
                  index: lines.length
                });
              }
            }
            return lines;
          }

          const lines = getTextLines();
          const matchingLine = lines.find(line => 
            line.text.trim() === targetText.trim() || 
            line.text.includes(targetText.trim())
          );
          
          return matchingLine ? {
            text: matchingLine.text,
            index: matchingLine.index
          } : null;
        }, selectedContent);

        if (!result) {
          console.log(`第 ${4 - retryCount} 次尝试: 未找到目标内容`);
          throw new Error('未找到目标内容');
        }

        await browser.close();
        return result;
      }
      
      // 整页监控时返回所有文本内容
      return await page.evaluate(() => {
        const excludeSelectors = [
          'footer', 'nav', '.footer', '.header', '.nav',
          '[role="navigation"]', '[role="contentinfo"]'
        ];
        
        // 获取所有可见的文本节点
        const textNodes = Array.from(document.body.getElementsByTagName('*'))
          .filter(element => {
            const isExcluded = excludeSelectors.some(selector => {
              try {
                return element.matches(selector);
              } catch {
                return false;
              }
            });
            
            if (isExcluded) return false;

            const style = window.getComputedStyle(element);
            const tagName = element.tagName.toLowerCase();
            return style.display !== 'none' && 
                   style.visibility !== 'hidden' &&
                   tagName !== 'script' && 
                   tagName !== 'style' && 
                   tagName !== 'meta' && 
                   tagName !== 'link';
          })
          .map(element => {
            // 获取元素的直接文本内容
            const textContent = Array.from(element.childNodes)
              .filter(node => node.nodeType === 3)
              .map(node => node.textContent.trim())
              .filter(text => text)
              .join('');
            
            return textContent;
          })
          .filter(text => text);

        // 返回格式化的文本，每行一个内容
        return textNodes.join('\n');
      });
    } catch (error) {
      await browser.close();
      console.error(`第 ${4 - retryCount} 次尝试失败:`, error.message);
      retryCount--;
      
      if (retryCount === 0) {
        throw new Error(`多次尝试后仍然失败: ${error.message}`);
      }
      
      // 在重试之前等待一段时间
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
  }
}

// 修改发送邮件前的任务状态更新逻辑
async function updateTaskAndSendEmail(taskId, email, url, content, newContent) {
  try {
    // 更新任务状态
    await new Promise((resolve, reject) => {
      db.run(
        `UPDATE monitoring_tasks 
         SET status = 'completed',
         read_status = 1,
         change_content = ?,
         last_change_time = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [content, taskId],
        err => err ? reject(err) : resolve()
      );
    });

    // 发送邮件通知
    await sendEmail(email, url, content);
  } catch (error) {
    console.error('更新任务状态或发送邮件失败:', error);
    throw error;
  }
}

// 修改开始监控的路由
app.post('/start-monitoring', async (req, res) => {
  const { url, email, monitorType, selectedContent, taskLabel } = req.body;
  console.log('收到监控请求:', { url, email, monitorType, selectedContent, taskLabel });

  try {
    // 检查用户权限
    const user = await new Promise((resolve, reject) => {
      db.get('SELECT * FROM users WHERE email = ?', [email], (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });

    // 获取当前活跃任务数
    const activeTasks = await new Promise((resolve, reject) => {
      db.all(
        'SELECT COUNT(*) as count FROM monitoring_tasks WHERE email = ? AND status = "active"',
        [email],
        (err, rows) => {
          if (err) reject(err);
          else resolve(rows[0].count);
        }
      );
    });

    // 检查任务数量限制
    if (user.membership_level !== 'pro' && activeTasks >= 2) {
      return res.status(403).json({
        message: '普通会员最多只能同时监控2个网页，请升级到Pro会员解锁更多功能'
      });
    }

    // 创建新任务记录，确保使用正确的时间格式
    const taskId = await new Promise((resolve, reject) => {
      db.run(
        `INSERT INTO monitoring_tasks 
         (email, url, monitor_type, selected_content, status, start_time, task_label) 
         VALUES (?, ?, ?, ?, 'active', datetime('now', 'localtime'), ?)`,
        [email, url, monitorType, selectedContent, taskLabel],
        function(err) {
          if (err) reject(err);
          else resolve(this.lastID);
        }
      );
    });
    
    const taskKey = `${url}_${selectedContent || 'full'}`;

    const initialContent = await getPageContent(url, monitorType, selectedContent);
    if (!initialContent) {
      return res.status(400).json({ message: '无法找到指定的内容' });
    }

    console.log('初始内容:', initialContent);
    if (monitorType === 'partial') {
      previousContent[taskId] = {
        text: initialContent.text,
        index: initialContent.index
      };
    } else {
      previousContent[taskId] = initialContent;
    }

    const intervalId = setInterval(async () => {
      try {
        console.log(`\n正在检查 ${url} 的更新 (${new Date().toLocaleString()})`);
        
        const newContent = await getPageContent(url, monitorType, selectedContent);
        if (!newContent) {
          const content = `监控的网页内容已发生变化，请查看:\n${url}`;
          await updateTaskAndSendEmail(taskId, email, url, content, null);
          const task = monitoringTasks.get(taskKey);
          if (task) {
            clearInterval(task.intervalId);
            monitoringTasks.delete(taskKey);
          }
          return;
        }
        
        if (monitorType === 'partial') {
          if (!newContent) {
            const content = `监控的内容已不存在:\n${selectedContent}`;
            await updateTaskAndSendEmail(taskId, email, url, content, null);
            const task = monitoringTasks.get(taskKey);
            if (task) {
              clearInterval(task.intervalId);
              monitoringTasks.delete(taskKey);
            }
          } else {
            if (newContent.index !== previousContent[taskId].index) {
              const content = `监控内容位置发生变化:\n` +
                `原位置: 第${previousContent[taskId].index + 1}行\n` +
                `新位置: 第${newContent.index + 1}行\n` +
                `监控内容: ${newContent.text}`;
              await updateTaskAndSendEmail(taskId, email, url, content, newContent);
              const task = monitoringTasks.get(taskKey);
              if (task) {
                clearInterval(task.intervalId);
                monitoringTasks.delete(taskKey);
              }
            } else if (newContent.text !== previousContent[taskId].text) {
              const content = `监控位置(第${newContent.index + 1}行)的内容发生变化:\n` +
                `原文: ${previousContent[taskId].text}\n` +
                `新文: ${newContent.text}`;
              await updateTaskAndSendEmail(taskId, email, url, content, newContent);
              const task = monitoringTasks.get(taskKey);
              if (task) {
                clearInterval(task.intervalId);
                monitoringTasks.delete(taskKey);
              }
            } else {
              console.log(`${url} - 监控内容无变化`);
            }
          }
        } else {
          // 整页监控
          if (newContent !== previousContent[taskId]) {
            const difference = getTextDifference(previousContent[taskId], newContent);
            if (difference !== '未检测到差异') {
              await updateTaskAndSendEmail(taskId, email, url, difference, newContent);
              const task = monitoringTasks.get(taskKey);
              if (task) {
                clearInterval(task.intervalId);
                monitoringTasks.delete(taskKey);
              }
            } else {
              console.log(`${url} - 无变化`);
            }
          } else {
            console.log(`${url} - 无变化`);
          }
        }
      } catch (error) {
        console.error(`监控出错 (${url}):`, error.message);
      }
    }, 30000);

    monitoringTasks.set(taskKey, {
      intervalId,
      email,
      startTime: new Date(),
      selectedContent,
      taskId  // 保存数据库ID
    });

    res.json({ message: '监控已开始' });
  } catch (error) {
    console.error('启动监控失败:', error);
    res.status(500).json({ message: '启动监控失败' });
  }
});

// 修改取消监控的接口
app.post('/cancel-task', async (req, res) => {
  const { taskId } = req.body;
  
  try {
    // 先从数据库获取任务信息
    const task = await new Promise((resolve, reject) => {
      db.get('SELECT * FROM monitoring_tasks WHERE id = ?', [taskId], (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });

    if (!task) {
      return res.status(404).json({ message: '未找到该监控任务' });
    }

    // 构造 taskKey
    const taskKey = `${task.url}_${task.selected_content || 'full'}`;
    
    // 清除定时器
    const monitoringTask = monitoringTasks.get(taskKey);
    if (monitoringTask) {
      clearInterval(monitoringTask.intervalId);
      monitoringTasks.delete(taskKey);
    }

    // 更新数据库状态
    await new Promise((resolve, reject) => {
      db.run(
        'UPDATE monitoring_tasks SET status = "completed" WHERE id = ?',
        [taskId],
        err => err ? reject(err) : resolve()
      );
    });

    res.json({ message: '监控已取消' });
  } catch (error) {
    console.error('取消任务失败:', error);
    res.status(500).json({ message: '取消任务失败' });
  }
});

// 修改邮件发送函数
function sendEmail(to, url, content) {
  const mailOptions = {
    from: process.env.SMTP_USER,
    to,
    subject: '【1stday】监控网页内容变更通知',
    text: `您监控的网页 ${url} 内容已发生变化，请查看。\n\n${content}`,
  };

  return new Promise((resolve, reject) => {
    transporter.sendMail(mailOptions, (err, info) => {
      if (err) {
        console.error('发送邮件时出错: ', err);
        reject(err);
      } else {
        console.log('邮件已发送: ' + info.response);
        resolve(info);
      }
    });
  });
}

// 保存 HTML 内容到 SQLite 数据库
function saveToDatabase(url, htmlContent, email) {
  return new Promise((resolve, reject) => {
    const stmt = db.prepare('INSERT INTO webpages (url, html_content, email) VALUES (?, ?, ?)');
    stmt.run(url, htmlContent, email, function (err) {
      if (err) {
        reject(err);
      } else {
        console.log(`网页内容已保存到 SQLite: ${url}`);
        resolve(this.lastID);
      }
    });
    stmt.finalize();
  });
}

// 添加一个用于显示当前监控状态的接口
app.get('/monitoring-status', (req, res) => {
  const status = Array.from(monitoringTasks.entries()).map(([url, task]) => ({
    url,
    email: task.email,
    startTime: task.startTime,
    runningTime: Math.floor((new Date() - task.startTime) / 1000) + ' 秒'
  }));
  
  res.json(status);
});

// 添加新的路由来获取用户的监控任务
app.get('/user-monitors', async (req, res) => {
  const { email } = req.query;
  
  if (!email) {
    return res.status(400).json({ message: '请提供邮箱地址' });
  }

  try {
    // 从数据库获取该用户的监控记录
    const db = new sqlite3.Database('monitoring.db');
    
    const monitoringTasks = Array.from(monitoringTasks.entries())
      .filter(([_, task]) => task.email === email)
      .map(([url, task]) => ({
        url,
        startTime: task.startTime,
        runningTime: Math.floor((new Date() - task.startTime) / 1000),
      }));

    // 获取历史记录
    const getHistory = () => {
      return new Promise((resolve, reject) => {
        db.all(
          `SELECT url, content, timestamp 
           FROM monitoring_history 
           WHERE email = ? 
           ORDER BY timestamp DESC`,
          [email],
          (err, rows) => {
            if (err) reject(err);
            else resolve(rows);
          }
        );
      });
    };

    const history = await getHistory();

    // 合并当前监控和历史记录
    const monitors = monitoringTasks.map(task => {
      const lastChange = history.find(h => h.url === task.url);
      return {
        url: task.url,
        status: '监控中',
        startTime: new Date(task.startTime).toLocaleString(),
        runningTime: `${Math.floor(task.runningTime / 3600)}小时${Math.floor((task.runningTime % 3600) / 60)}分钟`,
        lastChangeTime: lastChange ? new Date(lastChange.timestamp).toLocaleString() : '暂无变化'
      };
    });

    res.json(monitors);
  } catch (error) {
    console.error('获取监控列表失败:', error);
    res.status(500).json({ message: '获取监控列表失败' });
  }
});

// 添加用户认证相关的API端点
app.post('/auth/register', async (req, res) => {
  const { email, password } = req.body;
  
  if (!email || !password) {
    return res.status(400).json({ message: '邮箱和密码都是必需的' });
  }

  try {
    // 检查用户是否已存在
    const checkUser = await new Promise((resolve, reject) => {
      db.get('SELECT email FROM users WHERE email = ?', [email], (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });

    if (checkUser) {
      return res.status(400).json({ message: '该邮箱已被注册' });
    }

    // 存储新用户
    await new Promise((resolve, reject) => {
      db.run('INSERT INTO users (email, password) VALUES (?, ?)', 
        [email, password], // 实际应用中应该对密码进行加密
        (err) => {
          if (err) reject(err);
          else resolve();
        });
    });

    res.json({ message: '注册成功' });
  } catch (error) {
    console.error('注册失败:', error);
    res.status(500).json({ message: '注册失败' });
  }
});

app.post('/login', async (req, res) => {
  const { email, password } = req.body;

  try {
    // 确保设置正确的响应头
    res.setHeader('Content-Type', 'application/json');

    // 查询用户
    const user = await new Promise((resolve, reject) => {
      db.get('SELECT * FROM users WHERE email = ?', [email], (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });

    if (user && user.password === password) {
      res.json({
        success: true,
        email: user.email,
        membership_level: user.membership_level || 'basic'
      });
    } else {
      res.status(401).json({
        success: false,
        message: '邮箱或密码错误'
      });
    }
  } catch (error) {
    console.error('登录失败:', error);
    res.status(500).json({
      success: false,
      message: '服务器错误'
    });
  }
});

// 修改获取用户任务的路由
app.get('/user-tasks', async (req, res) => {
  const { email } = req.query;
  
  try {
    const tasks = await new Promise((resolve, reject) => {
      db.all(
        `SELECT *, datetime(start_time, 'localtime') as start_time,
                datetime(last_check_time, 'localtime') as last_check_time,
                datetime(last_change_time, 'localtime') as last_change_time
         FROM monitoring_tasks 
         WHERE email = ?
         ORDER BY start_time DESC`,
        [email],
        (err, rows) => err ? reject(err) : resolve(rows)
      );
    });
    
    res.json(tasks);
  } catch (error) {
    console.error('获取任务列表失败:', error);
    res.status(500).json({ message: '获取任务列表失败' });
  }
});

// 修改取消任务的路由
app.post('/cancel-task', async (req, res) => {
  const { taskId } = req.body;
  console.log('收到取消监控请求:', taskId);

  try {
    // 获取任务信息
    const task = await new Promise((resolve, reject) => {
      db.get('SELECT * FROM monitoring_tasks WHERE id = ?', [taskId],
        (err, row) => err ? reject(err) : resolve(row)
      );
    });

    if (!task) {
      return res.status(404).json({ message: '任务不存在' });
    }

    // 停止监控进程
    const taskKey = `${task.url}_${task.selected_content || 'full'}`;
    if (monitoringTasks.has(taskKey)) {
      clearInterval(monitoringTasks.get(taskKey).intervalId);
      monitoringTasks.delete(taskKey);
      console.log('已停止监控任务:', taskKey);
    }

    // 更新数据库状态为已完成
    await new Promise((resolve, reject) => {
      db.run(
        'UPDATE monitoring_tasks SET status = ?, last_check_time = CURRENT_TIMESTAMP WHERE id = ?',
        ['completed', taskId],
        err => err ? reject(err) : resolve()
      );
    });

    console.log('已更新任务状态为已完成');
    res.json({ message: '监控已取消' });
  } catch (error) {
    console.error('取消任务失败:', error);
    res.status(500).json({ message: '取消任务失败' });
  }
});

// 恢复监控任务
app.post('/resume-task', async (req, res) => {
  const { taskId } = req.body;
  console.log('收到恢复监控请求:', taskId);

  try {
    // 获取任务信息
    const task = await new Promise((resolve, reject) => {
      db.get('SELECT * FROM monitoring_tasks WHERE id = ?', [taskId],
        (err, row) => err ? reject(err) : resolve(row)
      );
    });

    if (!task) {
      return res.status(404).json({ message: '任务不存在' });
    }

    // 更新数据库状态
    await new Promise((resolve, reject) => {
      db.run(
        'UPDATE monitoring_tasks SET status = ?, start_time = CURRENT_TIMESTAMP WHERE id = ?',
        ['active', taskId],
        err => err ? reject(err) : resolve()
      );
    });

    // 重新启动监控
    const taskKey = `${task.url}_${task.selected_content || 'full'}`;
    const initialContent = await getPageContent(task.url, task.monitor_type, task.selected_content);
    previousContent[taskKey] = initialContent;

    const intervalId = setInterval(async () => {
      try {
        console.log(`检查更新: ${task.url}`);
        const newContent = await getPageContent(task.url, task.monitor_type, task.selected_content);
        
        if (newContent !== previousContent[taskKey]) {
          console.log('检测到内容变化');
          // 发送邮件通知
          await sendEmail(task.email, task.url, '监控的网页内容已发生变化');
          
          // 更新数据库状态
          await new Promise((resolve, reject) => {
            db.run(
              'UPDATE monitoring_tasks SET status = ?, last_change_time = CURRENT_TIMESTAMP WHERE id = ?',
              ['completed', task.id],
              err => err ? reject(err) : resolve()
            );
          });

          // 停止监控
          clearInterval(intervalId);
          monitoringTasks.delete(taskKey);
          console.log('监控任务完成');
        } else {
          // 更新最后检查时间
          await new Promise((resolve, reject) => {
            db.run(
              'UPDATE monitoring_tasks SET last_check_time = CURRENT_TIMESTAMP WHERE id = ?',
              [task.id],
              err => err ? reject(err) : resolve()
            );
          });
        }
      } catch (error) {
        console.error('监控检查出错:', error);
      }
    }, 30000); // 每30秒检查一次

    monitoringTasks.set(taskKey, {
      intervalId,
      email: task.email,
      startTime: new Date()
    });

    console.log('已恢复监控任务');
    res.json({ message: '监控已恢复' });
  } catch (error) {
    console.error('恢复任务失败:', error);
    res.status(500).json({ message: '恢复任务失败' });
  }
});

// 修改检查页面内容的函数
async function checkPageContent(taskId, url, email, monitorType, selectedContent) {
  const taskKey = `${url}_${selectedContent || 'full'}`;
  try {
    const newContent = await getPageContent(url, monitorType, selectedContent);
    
    if (newContent !== previousContent[taskKey]) {
      console.log('检测到内容变化，任务ID:', taskId);
      
      // 发送邮件通知
      await sendEmail(email, url, '监控的网页内容已发生变化');
      
      // 更新数据库状态为已完成
      await new Promise((resolve, reject) => {
        db.run(
          `UPDATE monitoring_tasks 
           SET status = 'completed', 
               last_change_time = CURRENT_TIMESTAMP,
               last_check_time = CURRENT_TIMESTAMP,
               change_content = ?
           WHERE id = ?`,
          [newContent.substring(0, 500), taskId], // 存储变化的内容（限制长度）
          (err) => {
            if (err) {
              console.error('更新任务状态失败:', err);
              reject(err);
            } else {
              console.log('已更新任务状态为已完成');
              resolve();
            }
          }
        );
      });

      // 停止监控
      const task = monitoringTasks.get(taskKey);
      if (task) {
        clearInterval(task.intervalId);
        monitoringTasks.delete(taskKey);
        console.log('已停止监控任务:', taskKey);
      }
      
      return true;
    }
    
    // 仅更新最后检查时间
    await new Promise((resolve, reject) => {
      db.run(
        'UPDATE monitoring_tasks SET last_check_time = CURRENT_TIMESTAMP WHERE id = ?',
        [taskId],
        err => err ? reject(err) : resolve()
      );
    });
    
    return false;
  } catch (error) {
    console.error('检查内容出错:', error);
    return false;
  }
}

// 修改取消任务的路由
app.post('/cancel-task', async (req, res) => {
  const { taskId } = req.body;
  console.log('收到取消监控请求:', taskId);

  try {
    // 获取任务信息
    const task = await new Promise((resolve, reject) => {
      db.get('SELECT * FROM monitoring_tasks WHERE id = ?', [taskId],
        (err, row) => err ? reject(err) : resolve(row)
      );
    });

    if (!task) {
      return res.status(404).json({ message: '任务不存在' });
    }

    // 停止监控进程
    const taskKey = `${task.url}_${task.selected_content || 'full'}`;
    if (monitoringTasks.has(taskKey)) {
      clearInterval(monitoringTasks.get(taskKey).intervalId);
      monitoringTasks.delete(taskKey);
      console.log('已停止监控任务:', taskKey);
    }

    // 更新数据库状态为已完成
    await new Promise((resolve, reject) => {
      db.run(
        'UPDATE monitoring_tasks SET status = ?, last_check_time = CURRENT_TIMESTAMP WHERE id = ?',
        ['completed', taskId],
        err => err ? reject(err) : resolve()
      );
    });

    console.log('已更新任务状态为已完成');
    res.json({ message: '监控已取消' });
  } catch (error) {
    console.error('取消任务失败:', error);
    res.status(500).json({ message: '取消任务失败' });
  }
});

// 修改注册路由，添加会员等级记录
app.post('/register', async (req, res) => {
  const { email, password } = req.body;
  try {
    await new Promise((resolve, reject) => {
      db.run('INSERT INTO users (email, password) VALUES (?, ?)', 
        [email, password], 
        (err) => err ? reject(err) : resolve()
      );
    });
    
    // 添加会员等级记录
    await new Promise((resolve, reject) => {
      db.run('INSERT INTO membership_levels (email) VALUES (?)',
        [email],
        (err) => err ? reject(err) : resolve()
      );
    });
    
    res.json({ message: '注册成功' });
  } catch (error) {
    res.status(500).json({ message: '注册失败' });
  }
});

// 添加获取用户资料的路由
app.get('/user-profile', async (req, res) => {
  const { email } = req.query;
  
  if (!email) {
    return res.status(400).json({ message: '请提供邮箱地址' });
  }

  try {
    const profile = await new Promise((resolve, reject) => {
      db.get(
        'SELECT * FROM membership_levels WHERE email = ?',
        [email],
        (err, row) => err ? reject(err) : resolve(row)
      );
    });

    if (!profile) {
      return res.status(404).json({ message: '用户不存在' });
    }

    res.json(profile);
  } catch (error) {
    console.error('获取用户资料失败:', error);
    res.status(500).json({ message: '获取用户资料失败' });
  }
});

// 创建支付会话
app.post('/create-checkout-session', async (req, res) => {
  const { email } = req.body;
  console.log('创建支付会话，用户邮箱:', email);

  try {
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [
        {
          price_data: {
            currency: 'cny',
            product_data: {
              name: '网页监控 Pro 会员',
              description: '解锁全部监控功能，包括部分内容监控和无限监控数量',
            },
            unit_amount: 9900, // 99.00 CNY
          },
          quantity: 1,
        },
      ],
      mode: 'payment',
      success_url: `${process.env.BASE_URL || 'http://172.16.30:3000'}/payment-success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.BASE_URL || 'http://172.16.30:3000'}/payment-cancel`,
      customer_email: email,
    });

    console.log('支付会话创建成功:', session.id);
    // 直接返回 Stripe 的 checkout URL
    res.json({ url: session.url });  // 使用 session.url 而不是 sessionId
  } catch (error) {
    console.error('创建支付会话失败:', error);
    res.status(500).json({ error: error.message });
  }
});

// 支付成功页面
app.get('/payment-success', async (req, res) => {
  const { session_id } = req.query;
  console.log('收到支付成功回调，session_id:', session_id);
  
  try {
    const session = await stripe.checkout.sessions.retrieve(session_id);
    const customerEmail = session.customer_email;
    console.log('支付成功的用户邮箱:', customerEmail);

    // 更新用户的会员等级为 pro，移除 upgrade_date
    await new Promise((resolve, reject) => {
      db.run(
        'UPDATE users SET membership_level = ? WHERE email = ?',
        ['pro', customerEmail],
        (err) => {
          if (err) {
            console.error('更新会员等级失败:', err);
            reject(err);
          } else {
            console.log('已成功更新用户会员等级为 pro');
            resolve();
          }
        }
      );
    });

    // 返回成功页面
    res.send(`
      <html>
        <head>
          <title>支付成功</title>
          <style>
            body {
              font-family: Arial, sans-serif;
              display: flex;
              justify-content: center;
              align-items: center;
              height: 100vh;
              margin: 0;
              background-color: #f0f2f5;
            }
            .success-container {
              text-align: center;
              padding: 40px;
              background: white;
              border-radius: 8px;
              box-shadow: 0 2px 4px rgba(0,0,0,0.1);
            }
            .success-icon {
              color: #4CAF50;
              font-size: 48px;
              margin-bottom: 20px;
            }
            h1 { color: #333; }
            p { color: #666; }
          </style>
        </head>
        <body>
          <div class="success-container">
            <div class="success-icon">✓</div>
            <h1>支付成功！</h1>
            <p>您已成功升级到 Pro 会员</p>
            <p>现在可以关闭此页面，返回扩展继续使用</p>
          </div>
        </body>
      </html>
    `);
  } catch (error) {
    console.error('处理支付成功回调失败:', error);
    res.status(500).send('处理支付失败');
  }
});

// 支付取消页面
app.get('/payment-cancel', (req, res) => {
  res.send(`
    <html>
      <head>
        <title>支付取消</title>
        <style>
          body {
            font-family: Arial, sans-serif;
            display: flex;
            justify-content: center;
            align-items: center;
            height: 100vh;
            margin: 0;
            background-color: #f0f2f5;
          }
          .cancel-container {
            text-align: center;
            padding: 40px;
            background: white;
            border-radius: 8px;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
          }
          h1 { color: #333; }
          p { color: #666; }
        </style>
      </head>
      <body>
        <div class="cancel-container">
          <h1>支付已取消</h1>
          <p>您可以关闭此页面，返回扩展继续使用</p>
        </div>
      </body>
    </html>
  `);
});

// 修改用户资料接口，添加会员等级信息
app.get('/user-profile', async (req, res) => {
  const { email } = req.query;
  
  try {
    const user = await new Promise((resolve, reject) => {
      db.get(
        'SELECT email, membership_level, created_at as join_date, upgrade_date FROM users WHERE email = ?',
        [email],
        (err, row) => {
          if (err) reject(err);
          else resolve(row);
        }
      );
    });

    if (!user) {
      return res.status(404).json({ message: '用户不存在' });
    }

    res.json({
      email: user.email,
      level: user.membership_level || 'basic',
      join_date: user.join_date,
      upgrade_date: user.upgrade_date
    });
  } catch (error) {
    console.error('获取用户资料失败:', error);
    res.status(500).json({ message: '获取用户资料失败' });
  }
});

app.get('/users/:email', async (req, res) => {
  const { email } = req.params;
  try {
    const user = await new Promise((resolve, reject) => {
      db.get('SELECT * FROM users WHERE email = ?', [email], (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });
    
    if (!user) {
      return res.status(404).json({ message: '用户不存在' });
    }
    
    res.json(user);
  } catch (error) {
    console.error('获取用户信息失败:', error);
    res.status(500).json({ message: '获取用户信息失败' });
  }
});

// 获取用户的监控任务
app.get('/monitoring-tasks', async (req, res) => {
  const { email } = req.query;
  
  try {
    const tasks = await new Promise((resolve, reject) => {
      db.all(
        'SELECT * FROM monitoring_tasks WHERE email = ? AND status = "active"',
        [email],
        (err, rows) => {
          if (err) reject(err);
          else resolve(rows);
        }
      );
    });
    
    res.json(tasks);
  } catch (error) {
    console.error('获取监控任务失败:', error);
    res.status(500).json({ message: '获取监控任务失败' });
  }
});

// 添加获取变化提醒的路由
app.get('/notifications', async (req, res) => {
  const { email } = req.query;
  try {
    const notifications = await new Promise((resolve, reject) => {
      db.all(
        `SELECT id, url, change_content, 
          COALESCE(last_change_time, last_check_time) as last_change_time,
          COALESCE(read_status, 0) as read_status
         FROM monitoring_tasks 
         WHERE email = ? AND change_content IS NOT NULL 
         ORDER BY last_change_time DESC`,
        [email],
        (err, rows) => err ? reject(err) : resolve(rows)
      );
    });
    res.json(notifications);
  } catch (error) {
    console.error('获取变化提醒失败:', error);
    res.status(500).json({ message: '获取变化提醒失败' });
  }
});

// 添加标记提醒为已读的路由
app.post('/mark-notification-read', async (req, res) => {
  const { taskId } = req.body;
  try {
    await new Promise((resolve, reject) => {
      db.run(
        'UPDATE monitoring_tasks SET read_status = 1, change_content = NULL WHERE id = ?',
        [taskId],
        err => err ? reject(err) : resolve()
      );
    });
    res.json({ message: '已标记为已读' });
  } catch (error) {
    console.error('标记提醒已读失败:', error);
    res.status(500).json({ message: '标记提醒已读失败' });
  }
});

// 修改处理内容变化的函数
async function handleContentChange(task, newContent, changes) {
  try {
    console.log(`处理任务ID: ${task.id} 的内容变化`);
    
    // 生成变化内容描述
    const changeDescription = differences
      .filter(part => part.added || part.removed)
      .map(part => {
        if (part.added) return `新增: ${part.value}`;
        if (part.removed) return `删除: ${part.value}`;
        return '';
      })
      .join('\n');

    // 更新数据库中的任务状态和变化内容
    await new Promise((resolve, reject) => {
      db.run(
        `UPDATE monitoring_tasks 
         SET status = 'completed',
             last_content = ?, 
             last_check_time = CURRENT_TIMESTAMP, 
             change_content = ?,
             last_change_time = CURRENT_TIMESTAMP,
             read_status = 0 
         WHERE id = ?`,
        [newContent, changeDescription, task.id],
        err => err ? reject(err) : resolve()
      );
    });
    console.log(`任务ID: ${task.id} 状态已更新，变化内容已记录`);

    // 停止监控进程
    const taskKey = `${task.url}_${task.selected_content || 'full'}`;
    if (monitoringTasks.has(taskKey)) {
      clearInterval(monitoringTasks.get(taskKey).intervalId);
      monitoringTasks.delete(taskKey);
      console.log(`已停止监控任务: ${taskKey}`);
    }

    // 发送邮件通知
    await sendEmail(
      task.email,
      '网页监控提醒 - 发现内容更新',
      `监控的网页 ${task.url} 发现内容更新：\n\n${changeDescription}\n\n请访问原网页查看详细内容。`
    );
    console.log(`已发送更新通知邮件给: ${task.email}`);

  } catch (error) {
    console.error('处理内容变化失败:', error);
  }
}

// 添加标记已读的路由
app.post('/mark-read', async (req, res) => {
  const { taskId } = req.body;
  
  try {
    await new Promise((resolve, reject) => {
      db.run(
        'UPDATE monitoring_tasks SET read_status = 0 WHERE id = ?',
        [taskId],
        err => err ? reject(err) : resolve()
      );
    });
    
    res.json({ message: '已标记为已读' });
  } catch (error) {
    console.error('标记已读失败:', error);
    res.status(500).json({ message: '标记已读失败' });
  }
});

// 添加会话检查端点
app.get('/check-session', async (req, res) => {
  const { email } = req.query;
  try {
    // 检查用户是否存在
    const user = await new Promise((resolve, reject) => {
      db.get('SELECT * FROM users WHERE email = ?', [email], (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });
    
    if (user) {
      res.json({ valid: true });
    } else {
      res.status(401).json({ valid: false });
    }
  } catch (error) {
    console.error('检查会话失败:', error);
    res.status(500).json({ valid: false });
  }
});

// 修改服务器启动代码
app.listen(port, host, () => {
  console.log(`服务运行在 http://${host}:${port}`);
});

async function checkWebsiteContent(task) {
  console.log(`\n正在检查 ${task.url} 的更新 (${new Date().toLocaleString()})`);
  
  try {
    const response = await axios.get(task.url);
    const $ = cheerio.load(response.data);
    
    // 获取当前内容
    const currentContent = task.monitor_type === 'partial' ? 
      $(task.selected_content).text().trim() :
      $('body').text().trim();
      
    if (!currentContent) {
      console.log('未找到目标内容');
      await sendEmail(
        task.email,
        '网页监控提醒 - 无法获取内容',
        `监控的网页 ${task.url} 无法获取目标内容，请检查网页是否正常或选择器是否正确。`
      );
      return;
    }

    // 如果是第一次检查
    if (!task.last_content) {
      await updateTaskContent(task.id, currentContent);
      console.log(`${task.url} - 初始内容已保存`);
      return;
    }

    // 使用 diff 比较内容变化
    const differences = Diff.diffWords(task.last_content, currentContent);
    const hasChanges = differences.some(part => part.added || part.removed);

    if (hasChanges) {
      console.log(`${task.url} - 发现内容变化`);
      
      // 生成变化内容的描述
      const changes = differences
        .filter(part => part.added || part.removed)
        .map(part => {
          if (part.added) return `新增: ${part.value}`;
          if (part.removed) return `删除: ${part.value}`;
          return '';
        })
        .join('\n');

      // 更新任务状态和发送通知
      await handleContentChange(task, currentContent, changes);

      // 停止当前的监控进程
      const taskKey = `${task.url}_${task.selected_content || 'full'}`;
      if (monitoringTasks.has(taskKey)) {
        clearInterval(monitoringTasks.get(taskKey).intervalId);
        monitoringTasks.delete(taskKey);
        console.log('已停止监控任务:', taskKey);
      }
    } else {
      // 仅更新最后检查时间
      await new Promise((resolve, reject) => {
        db.run(
          'UPDATE monitoring_tasks SET last_check_time = CURRENT_TIMESTAMP WHERE id = ?',
          [task.id],
          err => err ? reject(err) : resolve()
        );
      });
      console.log(`${task.url} - 无变化`);
    }
  } catch (error) {
    console.error(`检查网页失败: ${error.message}`);
    await sendEmail(
      task.email,
      '网页监控提醒 - 访问失败',
      `监控的网页 ${task.url} 访问失败，错误信息: ${error.message}`
    );
  }
}
