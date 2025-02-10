let selectedText = '';
let currentUser = null;

// 从环境变量获取 API 基础 URL
const API_BASE_URL = process.env.API_BASE_URL;

// 语言配置
const translations = {
  zh: {
    back: '返回',
    logout: '退出',
    account: '个人账号',
    membershipLevel: '会员等级',
    joinTime: '加入时间',
    normalMember: '普通会员',
    proMember: 'PRO会员',
    upgradeToPro: '升级到Pro',
    monitoring: '监控中',
    url: 'URL',
    monitorType: '类型',
    fullPage: '整页监控',
    partial: '部分监控',
    tag: '标签',
    noTag: '无',
    runningTime: '已运行',
    stopMonitor: '停止监控',
    // 会员对比弹窗
    membershipCompare: '会员等级对比',
    normalMemberFeatures: {
      title: '普通会员',
      features: [
        '✓ 整页监控',
        '✓ 最多同时监控3个网页',
        '✗ 部分内容监控',
        '✗ 自定义监控周期'
      ],
      price: '免费'
    },
    proMemberFeatures: {
      title: 'PRO会员',
      features: [
        '✓ 整页监控',
        '✓ 最多同时监控3个网页',
        '✓ 部分内容监控',
        '✓ 自定义监控周期（最短一分钟）'
      ],
      price: '¥99/年'
    },
    upgradeNow: '立即升级'
  },
  en: {
    back: 'Back',
    logout: 'Logout',
    account: 'Account',
    membershipLevel: 'Membership',
    joinTime: 'Join Date',
    normalMember: 'Normal Member',
    proMember: 'PRO Member',
    upgradeToPro: 'Upgrade to Pro',
    monitoring: 'Monitoring',
    url: 'URL',
    monitorType: 'Type',
    fullPage: 'Full Page',
    partial: 'Partial',
    tag: 'Tag',
    noTag: 'None',
    runningTime: 'Running for',
    stopMonitor: 'Stop',
    // Membership comparison modal
    membershipCompare: 'Membership Comparison',
    normalMemberFeatures: {
      title: 'Normal Member',
      features: [
        '✓ Full page monitoring',
        '✓ Monitor up to 3 pages',
        '✗ Partial content monitoring',
        '✗ Custom monitoring interval'
      ],
      price: 'Free'
    },
    proMemberFeatures: {
      title: 'PRO Member',
      features: [
        '✓ Full page monitoring',
        '✓ Monitor up to 3 pages',
        '✓ Partial content monitoring',
        '✓ Custom interval (min 1 min)'
      ],
      price: '$14/year'
    },
    upgradeNow: 'Upgrade Now'
  }
};

// 当前语言
let currentLang = 'zh';

// 更新页面文本
function updatePageLanguage() {
  const t = translations[currentLang];
  
  // 更新导航栏
  document.querySelector('.back-btn').textContent = 
    currentLang === 'zh' ? '← ' + t.back : '← ' + t.back;
  document.querySelector('.logout-btn').textContent = t.logout;
  document.getElementById('langToggle').textContent = 
    currentLang === 'zh' ? 'EN' : '中文';
    
  // 更新用户信息
  document.querySelector('.user-info-item:nth-child(1) .label').textContent = 
    t.account + ': ';
  document.querySelector('.user-info-item:nth-child(2) .label').textContent = 
    t.membershipLevel + ': ';
  document.querySelector('.user-info-item:nth-child(3) .label').textContent = 
    t.joinTime + ': ';
    
  // 更新监控列表
  document.querySelectorAll('.task-item').forEach(task => {
    const typeText = task.querySelector('.monitor-type').textContent;
    task.querySelector('.monitor-type').textContent = 
      typeText.includes('整页') ? t.fullPage : t.partial;
    task.querySelector('.stop-btn').textContent = t.stopMonitor;
  });
}

// 绑定语言切换按钮
document.getElementById('langToggle')?.addEventListener('click', () => {
  currentLang = currentLang === 'zh' ? 'en' : 'zh';
  updatePageLanguage();
});

// 初始化时更新语言
document.addEventListener('DOMContentLoaded', () => {
  updatePageLanguage();
});

// 检查登录状态的函数
async function checkAuthStatus() {
  try {
    const { user } = await chrome.storage.local.get('user');
    if (user && user.email) {
      currentUser = user;
      await showMainContainer();
      
      // 验证服务器端会话
      const response = await fetch(`${API_BASE_URL}/check-session?email=${user.email}`);
      if (response.ok) {
        return; // 会话有效，保持当前状态
      }
    }
    showAuthContainer();
  } catch (error) {
    console.error('检查登录状态失败:', error);
  }
}

// 显示主容器
function showMainContainer() {
  document.getElementById('authContainer').style.display = 'none';
  document.getElementById('mainContainer').style.display = 'block';
  document.getElementById('profilePanel').style.display = 'none';
}

// 显示登录容器
function showAuthContainer() {
  document.getElementById('authContainer').style.display = 'block';
  document.getElementById('mainContainer').style.display = 'none';
  document.getElementById('profilePanel').style.display = 'none';
}

// 切换登录/注册表单
document.getElementById('showRegister').addEventListener('click', () => {
  document.getElementById('loginForm').style.display = 'none';
  document.getElementById('registerForm').style.display = 'block';
});

document.getElementById('showLogin').addEventListener('click', () => {
  document.getElementById('registerForm').style.display = 'none';
  document.getElementById('loginForm').style.display = 'block';
});

// 登录处理
document.getElementById('loginButton')?.addEventListener('click', async () => {
  const email = document.getElementById('loginEmail').value;
  const password = document.getElementById('loginPassword').value;

  try {
    const response = await fetch(`${API_BASE_URL}/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ email, password })
    });

    // 先检查响应类型
    const contentType = response.headers.get('content-type');
    if (!contentType || !contentType.includes('application/json')) {
      console.error('服务器返回了非JSON格式的数据');
      return;
    }

    const data = await response.json();
    
    if (response.ok) {
      // 存储用户信息
      await chrome.storage.local.set({ 
        user: { 
          email: email,
          membership_level: data.membership_level || 'basic'
        }
      });
      showMainContainer();
    } else {
      console.error('登录失败:', data.message);
    }
  } catch (error) {
    console.error('登录请求失败:', error);
  }
});

// 注册处理
document.getElementById('registerButton').addEventListener('click', async () => {
  const email = document.getElementById('registerEmail').value;
  const password = document.getElementById('registerPassword').value;

  try {
    const response = await fetch(`${API_BASE_URL}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });

    const data = await response.json();
    if (response.ok) {
      alert('注册成功，请登录');
      document.getElementById('registerForm').style.display = 'none';
      document.getElementById('loginForm').style.display = 'block';
    } else {
      alert(data.message);
    }
  } catch (error) {
    alert('注册失败，请检查网络连接');
  }
});

// 在页面加载时检查登录状态并恢复表单数据
document.addEventListener('DOMContentLoaded', async () => {
  await checkAuthStatus();
  
  // 恢复表单数据
  try {
    const { formData } = await chrome.storage.local.get('formData');
    if (formData) {
      // 恢复监控网址
      const urlInput = document.getElementById('url');
      if (urlInput && formData.url) {
        urlInput.value = formData.url;
      }

      // 恢复其他表单数据
      const monitorTypeSelect = document.getElementById('monitorType');
      const selectedContentArea = document.getElementById('selectedContent');
      const taskLabelInput = document.getElementById('taskLabel');
      const selectContentBtn = document.getElementById('select-content');

      if (monitorTypeSelect) monitorTypeSelect.value = formData.monitorType || 'full';
      if (selectedContentArea) {
        selectedContentArea.textContent = formData.selectedContent || '';
        selectedContentArea.style.display = formData.monitorType === 'partial' ? 'block' : 'none';
      }
      if (taskLabelInput) taskLabelInput.value = formData.taskLabel || '';
      if (selectContentBtn) {
        selectContentBtn.style.display = formData.monitorType === 'partial' ? 'block' : 'none';
      }
    }
  } catch (error) {
    console.error('恢复表单数据失败:', error);
  }

  // 为所有表单元素添加自动保存功能
  ['url', 'monitorType', 'taskLabel'].forEach(id => {
    const element = document.getElementById(id);
    if (element) {
      element.addEventListener('change', saveFormData);
      element.addEventListener('input', saveFormData);
    }
  });

  // 监听 selectedContent 的变化
  const selectedContent = document.getElementById('selectedContent');
  if (selectedContent) {
    const observer = new MutationObserver(saveFormData);
    observer.observe(selectedContent, { 
      childList: true, 
      characterData: true, 
      subtree: true 
    });
  }

  // 绑定所有按钮事件
  const monitorCurrentBtn = document.getElementById('monitor-current');
  const selectContentBtn = document.getElementById('select-content');
  const startMonitoringBtn = document.getElementById('start-monitoring');
  const profileButton = document.getElementById('profileButton');

  // 获取当前页面URL按钮
  if (monitorCurrentBtn) {
    monitorCurrentBtn.addEventListener('click', async () => {
      try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tab && tab.url) {
          document.getElementById('url').value = tab.url;
        }
      } catch (error) {
        console.error('获取当前页面URL失败:', error);
        alert('获取当前页面URL失败');
      }
    });
  }

  // 选择监控内容按钮
  if (selectContentBtn) {
    selectContentBtn.addEventListener('click', async () => {
      try {
        const { user } = await chrome.storage.local.get('user');
        if (!user) return;

        // 检查会员等级
        const response = await fetch(`${API_BASE_URL}/users/${user.email}`);
        const userData = await response.json();
        
        if (userData.membership_level !== 'pro') {
          alert('部分监控为Pro会员专享功能，请升级会员以使用此功能');
          // 切换回整页监控
          const monitorType = document.getElementById('monitorType');
          if (monitorType) {
            monitorType.value = 'full';
            // 触发 change 事件以隐藏相关元素
            monitorType.dispatchEvent(new Event('change'));
          }
          return;
        }

        // 如果是 Pro 会员，继续执行选择内容的逻辑
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          function: enableContentSelection
        });
        window.close();
      } catch (error) {
        console.error('检查会员权限失败:', error);
        alert('操作失败，请稍后重试');
      }
    });
  }

  // 开始监控按钮
  if (startMonitoringBtn) {
    startMonitoringBtn.addEventListener('click', async () => {
      const { user } = await chrome.storage.local.get('user');
      if (!user) return;

      const url = document.getElementById('url').value;
      const monitorType = document.getElementById('monitorType').value;
      const taskLabel = document.getElementById('taskLabel').value;
      const selectedContent = document.getElementById('selectedContent').textContent;

      if (!url) {
        alert('请输入要监控的网址');
        return;
      }

      try {
        const response = await fetch(`${API_BASE_URL}/start-monitoring`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            url,
            email: user.email,
            monitorType,
            selectedContent: monitorType === 'partial' ? selectedContent : null,
            taskLabel
          })
        });

        const data = await response.json();
        if (response.ok) {
          alert('监控已开始');
          document.getElementById('url').value = '';
          document.getElementById('taskLabel').value = '';
          document.getElementById('selectedContent').textContent = '';
          document.getElementById('selectedContent').style.display = 'none';
        } else {
          alert(data.message);
        }
      } catch (error) {
        console.error('启动监控失败:', error);
        alert('启动监控失败，请检查网络连接');
      }
    });
  }

  // 个人中心按钮
  if (profileButton) {
    profileButton.addEventListener('click', () => {
      document.getElementById('mainContainer').style.display = 'none';
      document.getElementById('profilePanel').style.display = 'block';
      loadUserProfile();
      refreshTasksList();
    });
  }

  // 返回按钮
  const backToMain = document.getElementById('backToMain');
  if (backToMain) {
    backToMain.addEventListener('click', () => {
      document.getElementById('profilePanel').style.display = 'none';
      document.getElementById('mainContainer').style.display = 'block';
    });
  }

  // 退出登录按钮
  const logoutButton = document.getElementById('logoutButton');
  if (logoutButton) {
    logoutButton.addEventListener('click', async () => {
      await chrome.storage.local.remove('user');
      showAuthContainer();
    });
  }
});

// 将检查和设置显示状态的逻辑提取为独立函数
function updateContentGroupDisplay() {
  const monitorType = document.getElementById('monitorType');
  const contentGroup = document.querySelector('.form-group:has(#selectedContent)');
  const selectContentBtn = document.getElementById('select-content');
  
  if (!monitorType || !contentGroup) return;
  
  // 从 storage 获取保存的监控类型
  chrome.storage.local.get('formData', ({ formData = {} }) => {
    const savedType = formData.monitorType || 'full';
    
    // 同步下拉框的值
    monitorType.value = savedType;
    
    // 根据保存的类型设置显示状态
    if (savedType === 'partial') {
      contentGroup.style.display = 'block';
      if (selectContentBtn) selectContentBtn.style.display = 'block';
    } else {
      contentGroup.style.display = 'none';
      if (selectContentBtn) selectContentBtn.style.display = 'none';
    }
  });
}

// 在页面加载时检查状态
document.addEventListener('DOMContentLoaded', function() {
  const monitorType = document.getElementById('monitorType');
  const contentGroup = document.querySelector('.form-group:has(#selectedContent)');
  
  if (!monitorType || !contentGroup) return;
  
  // 初始化时更新显示状态
  updateContentGroupDisplay();
  
  // 监听切换事件，使用 immediate 函数确保立即执行
  monitorType.addEventListener('change', function() {
    const type = this.value;
    
    // 立即更新显示状态
    if (type === 'partial') {
      contentGroup.style.display = 'block';
      const selectContentBtn = document.getElementById('select-content');
      if (selectContentBtn) selectContentBtn.style.display = 'block';
    } else {
      contentGroup.style.display = 'none';
      const selectContentBtn = document.getElementById('select-content');
      if (selectContentBtn) selectContentBtn.style.display = 'none';
    }
    
    // 保存当前选择的监控类型
    saveFormData();
    
    // 强制重新计算布局
    contentGroup.offsetHeight;
  });
});

// 修改保存表单数据函数
async function saveFormData() {
  try {
    const formData = {
      url: document.getElementById('url')?.value || '',
      monitorType: document.getElementById('monitorType')?.value || 'full',
      selectedContent: document.getElementById('selectedContent')?.textContent || '',
      taskLabel: document.getElementById('taskLabel')?.value || ''
    };
    await chrome.storage.local.set({ formData });
    console.log('表单数据已保存:', formData);
    
    // 保存后立即更新显示状态
    updateContentGroupDisplay();
  } catch (error) {
    console.error('保存表单数据失败:', error);
  }
}

// 修改内容选择功能
function enableContentSelection() {
  let isSelecting = true;
  
  // 添加选择提示样式
  const style = document.createElement('style');
  style.textContent = `
    .monitoring-hover {
      background-color: rgba(255, 255, 0, 0.3) !important;
      cursor: pointer !important;
    }
  `;
  document.head.appendChild(style);

  // 鼠标悬停效果
  document.addEventListener('mouseover', function(e) {
    if (!isSelecting) return;
    
    if (e.target.classList) {
      e.target.classList.add('monitoring-hover');
    }
  });

  document.addEventListener('mouseout', function(e) {
    if (e.target.classList) {
      e.target.classList.remove('monitoring-hover');
    }
  });

  // 点击选择内容
  document.addEventListener('click', function(e) {
    if (!isSelecting) return;
    
    e.preventDefault();
    const selectedContent = e.target.textContent.trim();
    
    // 获取当前的表单数据，保持监控类型不变
    chrome.storage.local.get('formData', ({ formData = {} }) => {
      chrome.storage.local.set({ 
        formData: {
          ...formData,
          url: document.getElementById('url')?.value || '',
          selectedContent: selectedContent,
          taskLabel: document.getElementById('taskLabel')?.value || '',
          // 不再强制设置 monitorType
        }
      });
    });

    // 清理样式
    document.querySelectorAll('.monitoring-hover').forEach(el => {
      el.classList.remove('monitoring-hover');
    });
    
    isSelecting = false;
    
    // 提示用户已选择成功
    alert('内容选择成功！请重新打开插件继续操作。');
  }, true);
}

// 添加退出按钮事件监听
document.getElementById('logoutButton').addEventListener('click', async () => {
  await chrome.storage.local.remove('user');
  showAuthContainer();
});

// 修改任务列表的渲染方式
async function refreshTasksList() {
  try {
    const { user } = await chrome.storage.local.get('user');
    if (!user) return;

    const response = await fetch(`${API_BASE_URL}/monitoring-tasks?email=${user.email}`);
    const tasks = await response.json();
    
    const tasksContainer = document.querySelector('.tasks-list');
    tasksContainer.innerHTML = ''; // 清空现有内容
    
    tasks.forEach(task => {
      const taskElement = document.createElement('div');
      taskElement.className = 'task-item';
      taskElement.innerHTML = `
        <div class="task-content">
          <div class="task-line">
            <span class="label">URL：</span>
            <span class="url-text">${truncateUrl(task.url)}</span>
          </div>
          <div class="task-line">
            <span class="label">类型：</span>${task.monitor_type === 'full' ? '整页监控' : '部分监控'}
          </div>
          <div class="task-line">
            <span class="label">标签：</span>
            <span class="tag">${task.task_label || '无'}</span>
          </div>
          <div class="task-line">
            已运行${formatRunningTime(task.start_time)}
          </div>
        </div>
        <button class="stop-btn" data-task-id="${task.id}">停止监控</button>
      `;
      tasksContainer.appendChild(taskElement);
    });

    // 绑定停止按钮事件
    document.querySelectorAll('.stop-btn').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        const taskId = e.target.dataset.taskId;
        await cancelTask(taskId);
        await refreshTasksList();
      });
    });
  } catch (error) {
    console.error('刷新任务列表失败:', error);
  }
}

// 格式化运行时间
function formatRunningTime(startTime) {
  const start = new Date(startTime);
  const now = new Date();
  const diff = Math.floor((now - start) / 1000); // 转换为秒
  
  const hours = Math.floor(diff / 3600);
  const minutes = Math.floor((diff % 3600) / 60);
  
  return `${hours}小时${minutes}分钟`;
}

// 取消任务的函数
async function cancelTask(taskId) {
  try {
    const response = await fetch(`${API_BASE_URL}/cancel-task`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ taskId })
    });

    const data = await response.json();
    if (response.ok) {
      // 更新任务列表
      await refreshTasksList();
      
      // 更新活跃任务数量显示
      const activeTasksCount = document.getElementById('activeTasksCount');
      if (activeTasksCount && data.activeTasksCount !== undefined) {
        activeTasksCount.textContent = data.activeTasksCount;
      }

      // 如果是普通会员，检查是否需要重新启用开始监控按钮
      const { user } = await chrome.storage.local.get('user');
      if (user) {
        const userResponse = await fetch(`${API_BASE_URL}/users/${user.email}`);
        const userData = await userResponse.json();
        
        if (userData.membership_level !== 'pro' && data.activeTasksCount < 3) {
          const startMonitoringBtn = document.getElementById('start-monitoring');
          if (startMonitoringBtn) {
            startMonitoringBtn.disabled = false;
          }
          const statusElement = document.getElementById('status');
          if (statusElement) {
            statusElement.textContent = '';
          }
        }
      }
    } else {
      throw new Error(data.message || '取消任务失败');
    }
  } catch (error) {
    console.error('取消任务失败:', error);
    alert('取消任务失败: ' + error.message);
  }
}

// 加载用户资料
async function loadUserProfile() {
  try {
    const { user } = await chrome.storage.local.get('user');
    if (!user) return;

    // 获取用户信息
    const response = await fetch(`${API_BASE_URL}/users/${user.email}`);
    const userData = await response.json();
    
    // 显示用户邮箱
    document.getElementById('userEmail').textContent = userData.email;
    
    // 显示会员等级并设置样式
    const membershipLevel = document.getElementById('membershipLevel');
    const upgradeButton = document.getElementById('upgradeButton');
    
    if (userData.membership_level === 'pro') {
      membershipLevel.textContent = 'PRO会员';
      membershipLevel.classList.add('pro');
      upgradeButton.style.display = 'none';
    } else {
      membershipLevel.textContent = '普通会员';
      membershipLevel.classList.remove('pro');
      upgradeButton.style.display = 'block';
    }
    
    // 格式化并显示加入时间
    const joinDate = new Date(userData.created_at);
    document.getElementById('joinDate').textContent = 
      joinDate.toLocaleDateString('zh-CN');
    
    // 获取并显示活跃任务数
    const tasksResponse = await fetch(`${API_BASE_URL}/monitoring-tasks?email=${user.email}`);
    const tasks = await tasksResponse.json();
    document.getElementById('activeTasksCount').textContent = tasks.length;
  } catch (error) {
    console.error('加载用户资料失败:', error);
  }
}

// 修改刷新用户资料的函数
async function refreshUserProfile() {
  try {
    const { user } = await chrome.storage.local.get('user');
    if (!user || !user.email) return;

    console.log('开始刷新用户资料...');
    const response = await fetch(`${API_BASE_URL}/user-profile?email=${user.email}`);
    
    if (!response.ok) {
      throw new Error('获取用户资料失败');
    }

    const profile = await response.json();
    console.log('获取到的用户资料:', profile);
    
    // 更新会员等级显示
    const membershipLevelElement = document.getElementById('membershipLevel');
    if (membershipLevelElement) {
      membershipLevelElement.textContent = profile.membership_level === 'pro' ? 'PRO会员' : '普通会员';
      // 添加样式以突出显示PRO会员
      if (profile.membership_level === 'pro') {
        membershipLevelElement.style.color = 'gold';
        membershipLevelElement.style.fontWeight = 'bold';
      }
    }
    
    // 更新存储的用户信息
    await chrome.storage.local.set({
      user: { 
        ...user, 
        membership_level: profile.membership_level 
      }
    });

    // 根据会员等级控制升级按钮的显示
    const upgradeButton = document.getElementById('upgradeButton');
    if (upgradeButton) {
      upgradeButton.style.display = profile.membership_level === 'pro' ? 'none' : 'block';
    }

    // 如果是 PRO 会员，也隐藏会员模态框中的升级按钮
    const stripeCheckout = document.getElementById('stripeCheckout');
    if (stripeCheckout) {
      stripeCheckout.style.display = profile.membership_level === 'pro' ? 'none' : 'block';
    }

    console.log('用户资料已更新完成');
  } catch (error) {
    console.error('刷新用户资料失败:', error);
  }
}

// 修改会员权限检查函数
async function checkMembershipPermissions() {
  try {
    const { user } = await chrome.storage.local.get('user');
    if (!user) return null;

    const response = await fetch(`${API_BASE_URL}/users/${user.email}`);
    const userData = await response.json();
    
    // 获取开始监控按钮
    const startMonitoringBtn = document.getElementById('start-monitoring');
    
    if (userData.membership_level !== 'pro') {
      // 普通会员限制 - 只检查任务数量
      const tasksResponse = await fetch(`${API_BASE_URL}/monitoring-tasks?email=${user.email}`);
      const tasks = await tasksResponse.json();
      
      // 修改为最多2个监控任务
      if (tasks.length >= 2) {
        if (startMonitoringBtn) startMonitoringBtn.disabled = true;
        const statusElement = document.getElementById('status');
        if (statusElement) {
          statusElement.textContent = '普通会员最多只能监控2个网页，请升级到Pro会员解锁更多功能';
          statusElement.style.color = '#ff4444';
        }
      }
    } else {
      // Pro会员
      if (startMonitoringBtn) startMonitoringBtn.disabled = false;
      const statusElement = document.getElementById('status');
      if (statusElement) {
        statusElement.textContent = '';
      }
    }
    
    return userData.membership_level;
  } catch (error) {
    console.error('检查会员权限失败:', error);
    return null;
  }
}

// 移除其他重复的事件绑定

// 添加升级按钮的事件处理
document.getElementById('upgradeButton')?.addEventListener('click', async () => {
  try {
    const { user } = await chrome.storage.local.get('user');
    if (!user) {
      alert('请先登录！');
      return;
    }

    const response = await fetch(`${API_BASE_URL}/create-checkout-session`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email: user.email,
      }),
    });

    const data = await response.json();
    if (response.ok && data.url) {
      // 在新标签页中打开支付链接
      chrome.tabs.create({ url: data.url });
    } else {
      throw new Error(data.error || '创建支付会话失败');
    }
  } catch (error) {
    console.error('升级失败:', error);
    alert('升级失败，请稍后重试');
  }
});

// 添加会员模态框的显示/隐藏逻辑
document.getElementById('upgradeButton')?.addEventListener('click', () => {
  const modal = document.getElementById('membershipModal');
  if (modal) {
    modal.style.display = 'block';
  }
});

// 关闭模态框
document.querySelector('.close')?.addEventListener('click', () => {
  const modal = document.getElementById('membershipModal');
  if (modal) {
    modal.style.display = 'none';
  }
});

// 点击模态框外部关闭
window.addEventListener('click', (event) => {
  const modal = document.getElementById('membershipModal');
  if (event.target === modal) {
    modal.style.display = 'none';
  }
});

// Stripe 支付按钮点击事件
document.getElementById('stripeCheckout')?.addEventListener('click', async () => {
  try {
    const { user } = await chrome.storage.local.get('user');
    if (!user) {
      alert('请先登录！');
      return;
    }

    const response = await fetch(`${API_BASE_URL}/create-checkout-session`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email: user.email,
      }),
    });

    const data = await response.json();
    if (response.ok && data.url) {
      // 在新标签页中打开支付链接
      chrome.tabs.create({ url: data.url });
      // 关闭模态框
      document.getElementById('membershipModal').style.display = 'none';
    } else {
      throw new Error(data.error || '创建支付会话失败');
    }
  } catch (error) {
    console.error('创建支付会话失败:', error);
    alert('支付初始化失败，请稍后重试');
  }
});

// 移除其他可能的重复事件监听器
document.getElementById('upgradeButton')?.removeEventListener('click', () => {});
document.getElementById('stripeCheckout')?.removeEventListener('click', () => {});

// 修改刷新变化提醒的函数
async function refreshNotifications() {
  const { user } = await chrome.storage.local.get('user');
  if (!user) return;

  try {
    console.log('开始获取变化提醒...');
    // 获取所有任务的变化提醒
    const response = await fetch(`${API_BASE_URL}/user-tasks?email=${user.email}`);
    const tasks = await response.json();
    console.log('获取到的任务数据:', tasks);
    
    // 计算未读提醒数量（read_status 为 1 的数量）
    const unreadCount = tasks.filter(task => task.read_status === 1).length;
    
    // 更新未读提醒数量显示
    const notificationsCount = document.getElementById('notificationsCount');
    if (notificationsCount) {
      notificationsCount.textContent = unreadCount;
    }
    
    // 更新变化提醒列表
    const container = document.querySelector('.notifications-container');
    if (container) {
      container.innerHTML = ''; // 清空现有内容
      
      // 只显示 read_status 为 1 的任务
      const unreadTasks = tasks.filter(task => task.read_status === 1);
      
      if (unreadTasks.length === 0) {
        container.innerHTML = '<div class="no-notifications">暂无未读提醒</div>';
      } else {
        unreadTasks.forEach(task => {
          const notificationElement = document.createElement('div');
          notificationElement.className = 'notification-item';
          
          // 格式化时间
          const changeTime = new Date(task.last_change_time).toLocaleString('zh-CN', {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit'
          });
          
          notificationElement.innerHTML = `
            <div class="notification-content">
              <div class="notification-header">
                <span class="notification-label">${task.task_label || '未命名任务'}</span>
                <span class="notification-time">${changeTime}</span>
              </div>
              <div class="notification-url">${task.url}</div>
              <div class="notification-changes">${task.change_content || '内容已更新'}</div>
            </div>
            <button class="mark-read-btn" data-task-id="${task.id}">标记已读</button>
          `;
          
          container.appendChild(notificationElement);
        });
      }

      // 为所有"标记已读"按钮添加点击事件
      document.querySelectorAll('.mark-read-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
          const taskId = e.target.dataset.taskId;
          try {
            const response = await fetch(`${API_BASE_URL}/mark-read`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ taskId })
            });
            
            if (response.ok) {
              // 移除该提醒元素
              e.target.closest('.notification-item').remove();
              
              // 更新未读数量
              const count = document.getElementById('notificationsCount');
              if (count) {
                const newCount = parseInt(count.textContent) - 1;
                count.textContent = newCount;
              }
              
              // 如果没有更多未读提醒，显示暂无提醒消息
              if (container.children.length === 0) {
                container.innerHTML = '<div class="no-notifications">暂无未读提醒</div>';
              }
            }
          } catch (error) {
            console.error('标记已读失败:', error);
            alert('标记已读失败，请稍后重试');
          }
        });
      });
    }
  } catch (error) {
    console.error('刷新变化提醒失败:', error);
  }
}

// 在 DOMContentLoaded 事件中添加定期刷新
document.addEventListener('DOMContentLoaded', async () => {
  // 初始检查会员权限
  await checkMembershipPermissions();
  
  // 初始加载任务列表和通知
  await refreshTasksList();
  await refreshNotifications();
  
  // 每30秒刷新一次任务列表和通知
  setInterval(refreshTasksList, 30000);
  setInterval(refreshNotifications, 30000);

  // 监控类型变更时的处理
  const monitorType = document.getElementById('monitorType');
  if (monitorType) {
    monitorType.addEventListener('change', async () => {
      const { user } = await chrome.storage.local.get('user');
      if (!user) return;

      const response = await fetch(`${API_BASE_URL}/users/${user.email}`);
      const userData = await response.json();
      
      if (userData.membership_level !== 'pro' && monitorType.value === 'partial') {
        alert('部分内容监控为Pro会员专享功能，请升级会员以使用此功能');
        monitorType.value = 'full';
      }
    });
  }
  
  // 修改开始监控按钮的点击事件
  const startMonitoringBtn = document.getElementById('start-monitoring');
  if (startMonitoringBtn) {
    // 移除旧的事件监听器
    const newStartMonitoringBtn = startMonitoringBtn.cloneNode(true);
    startMonitoringBtn.parentNode.replaceChild(newStartMonitoringBtn, startMonitoringBtn);
    
    newStartMonitoringBtn.addEventListener('click', async (e) => {
      e.preventDefault();
      
      const { user } = await chrome.storage.local.get('user');
      if (!user) return;

      const userResponse = await fetch(`${API_BASE_URL}/users/${user.email}`);
      const userData = await userResponse.json();
      
      if (userData.membership_level !== 'pro') {
        const tasksResponse = await fetch(`${API_BASE_URL}/monitoring-tasks?email=${user.email}`);
        const tasks = await tasksResponse.json();
        
        if (tasks.length >= 3) {
          alert('普通会员最多只能监控3个网页，请升级到Pro会员解锁更多功能');
          return;
        }
      }
      
      // 继续原有的监控启动逻辑
      const formData = {
        url: document.getElementById('url').value.trim(),
        monitorType: document.getElementById('monitorType').value,
        taskLabel: document.getElementById('taskLabel')?.value?.trim() || '',
        selectedContent: null
      };

      if (!formData.url) {
        alert('请输入要监控的网址');
        return;
      }

      if (formData.monitorType === 'partial') {
        formData.selectedContent = document.getElementById('selectedContent')?.textContent?.trim() || '';
      }

      try {
        const response = await fetch(`${API_BASE_URL}/start-monitoring`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...formData,
            email: user.email
          })
        });

        if (response.ok) {
          document.getElementById('url').value = '';
          document.getElementById('taskLabel').value = '';
          if (document.getElementById('selectedContent')) {
            document.getElementById('selectedContent').textContent = '';
            document.getElementById('selectedContent').style.display = 'none';
          }
          await refreshTasksList();
          alert('监控已开始');
        } else {
          const data = await response.json();
          alert(data.message || '启动监控失败');
        }
      } catch (error) {
        console.error('启动监控失败:', error);
        alert('启动监控失败，请检查网络连接');
      }
    });
  }

  // 绑定关闭按钮事件
  const closeButton = document.querySelector('.close');
  if (closeButton) {
    const newCloseButton = closeButton.cloneNode(true);
    closeButton.parentNode.replaceChild(newCloseButton, closeButton);
    newCloseButton.addEventListener('click', () => {
      document.getElementById('membershipModal').style.display = 'none';
    });
  }

  // 点击模态框外部关闭
  window.onclick = (event) => {
    const modal = document.getElementById('membershipModal');
    if (event.target === modal) {
      modal.style.display = 'none';
    }
  };
});

// 在页面加载时恢复之前的表单数据
async function restoreFormData() {
  try {
    const { formData } = await chrome.storage.local.get('formData');
    if (formData) {
      const urlInput = document.getElementById('url');
      const monitorTypeSelect = document.getElementById('monitorType');
      const selectedContentArea = document.getElementById('selectedContent');
      const taskLabelInput = document.getElementById('taskLabel');

      if (urlInput) urlInput.value = formData.url || '';
      if (monitorTypeSelect) monitorTypeSelect.value = formData.monitorType || 'full';
      if (selectedContentArea) {
        selectedContentArea.textContent = formData.selectedContent || '';
        selectedContentArea.style.display = formData.selectedContent ? 'block' : 'none';
      }
      if (taskLabelInput) taskLabelInput.value = formData.taskLabel || '';
    }
  } catch (error) {
    console.error('恢复表单数据失败:', error);
  }
}

// 修改选择内容的处理函数
chrome.runtime.onMessage.addListener(async (message, sender, sendResponse) => {
  if (message.type === 'SELECTED_CONTENT') {
    document.getElementById('selectedContent').textContent = message.content;
    document.getElementById('selectedContent').style.display = 'block';
    await saveFormData(); // 保存选择的内容
  }
});

// 显示会员对比弹窗
function showMembershipModal() {
  document.getElementById('membershipModal').style.display = 'block';
}

// 处理所有升级按钮点击（包括弹窗内的立即升级按钮）
async function handleUpgradeClick() {
  try {
    // 先获取用户信息
    const { user } = await chrome.storage.local.get('user');
    if (!user || !user.email) {
      console.error('未找到用户信息');
      return;
    }

    const response = await fetch(`${API_BASE_URL}/create-checkout-session`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        priceId: 'price_H5ggYwtxfZxwce',
        email: user.email
      })
    });

    const session = await response.json();
    if (session.url) {
      // 使用 chrome.tabs.create 在新标签页打开支付链接
      chrome.tabs.create({ url: session.url });
      // 关闭弹窗
      document.getElementById('membershipModal').style.display = 'none';
    } else {
      throw new Error('支付会话创建失败');
    }
  } catch (error) {
    console.error('创建支付会话失败:', error);
    alert('创建支付会话失败，请稍后重试');
  }
}

// 绑定主页面的升级按钮
document.getElementById('upgradeButton')?.addEventListener('click', () => {
  showMembershipModal();
});

// 绑定弹窗中的立即升级按钮
document.getElementById('upgradeToPro')?.addEventListener('click', handleUpgradeClick);

// 处理监控类型选择
document.getElementById('monitorType')?.addEventListener('change', async (e) => {
  const { user } = await chrome.storage.local.get('user');
  if (!user) return;

  if (e.target.value === 'partial' && user.membership_level !== 'pro') {
    showMembershipModal();
    e.target.value = 'full'; // 重置为整页监控
  }
});

// 关闭弹窗
document.querySelector('.close')?.addEventListener('click', () => {
  document.getElementById('membershipModal').style.display = 'none';
});

// 点击弹窗外部关闭
window.onclick = (event) => {
  const modal = document.getElementById('membershipModal');
  if (event.target === modal) {
    modal.style.display = 'none';
  }
};

// 添加 URL 截断函数
function truncateUrl(url, maxLength = 23) {
  if (url.length <= maxLength) return url;
  return url.substring(0, maxLength) + '...';
}

// 修改任务卡片的渲染方式
function createTaskCard(task) {
  return `
    <div class="task-line">
      <span class="label">URL：</span>
      <span class="url-text">${truncateUrl(task.url)}</span>
    </div>
  `;
}
