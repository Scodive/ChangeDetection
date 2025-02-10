# ChangeDetection - A Web Content Monitor Chrome Extension
A powerful Chrome extension for monitoring web page content changes and notifying users in real-time.

## Features

- 🔍 Support for full-page and partial content monitoring
- 📧 Email notifications for content changes
- 👥 User account system
- 💎 Membership tiers (Normal/Pro)
- 🌐 Multi-language support (English/Chinese)
- 📝 Task labels and notes
- 📊 Real-time task status display

## Project Structure

```
web-content-monitor/
├── extension/
│   ├── popup/
│   │   ├── popup.html
│   │   ├── popup.css
│   │   └── popup.js
│   ├── icons/
│   │   └── icon.png
│   │   └── icon16.png
│   │   └── icon48.png
│   │   └── icon128.png
│   └── manifest.json
├── server/
│   ├── app.js
│   └── webpages.db
└── package.json
```

## Tech Stack

- Frontend: HTML, CSS, JavaScript
- Backend: Node.js, Express
- Database: SQLite3
- Dependencies:
  - nodemailer (email delivery)
  - puppeteer (web content scraping)
  - cheerio (HTML parsing)
  - stripe (payment processing)
  - diff (content comparison)

## Deployment Guide

### 1. Server Deployment

```bash
# Clone the repository
git clone [[repository-url]](https://github.com/Scodive/ChangeDetection.git)
cd ChangeDetection

# Install dependencies
npm install

# Install PM2
npm install -g pm2

# Start the service
pm2 start server/app.js --name "web-monitor"

# Configure startup
pm2 startup
pm2 save
```

### 2. Database Setup

The database will be created automatically on first run, including tables for:
- users (user information)
- monitoring_tasks (monitoring tasks)
- membership_levels (membership tiers)

### 3. Environment Configuration

Create a `.env` file:

```env
NODE_ENV=production
PORT=3000
SMTP_HOST=your-smtp-host
SMTP_USER=your-smtp-user
SMTP_PASS=your-smtp-password
STRIPE_KEY=your-stripe-key
```

### 4. Chrome Extension Installation

1. Open Chrome extensions page (`chrome://extensions/`)
2. Enable Developer mode
3. Click "Load unpacked"
4. Select the `extension` directory from the project

## Membership Tiers

### Normal Member
- Full-page monitoring
- Monitor up to 2 web pages simultaneously
- Basic email notifications

### Pro Member
- Full-page and partial content monitoring
- Unlimited monitored pages
- Custom monitoring intervals
- Priority email notifications

## API Reference

Main API endpoints:

```javascript
POST /register     // User registration
POST /login       // User login
POST /start-monitoring    // Start monitoring task
POST /stop-monitoring     // Stop monitoring task
GET /tasks        // Get monitoring tasks
POST /upgrade     // Upgrade membership
```

## Important Notes

1. Ensure server firewall allows access to port 3000
2. Configure SMTP service correctly for email notifications
3. Regularly backup the database file
4. Monitor PM2 logs for potential issues

## Installation Requirements

- Node.js 14.x or higher
- Chrome browser version 88 or higher
- SQLite3
- PM2 (for production deployment)

## Development Setup

```bash
# Install dependencies
npm install

# Start development server
npm run dev

# Run tests
npm test

# Build extension
npm run build
```

## Error Handling

The application includes comprehensive error handling for:
- Network connectivity issues
- Database operations
- Email delivery failures
- Content scraping errors

## Security Features

- Password encryption
- Rate limiting
- CORS protection
- Input validation
- XSS prevention

## License

MIT License

## Contributing

Contributions are welcome! Before submitting a Pull Request:
1. Ensure code follows project standards
2. Add necessary tests
3. Update relevant documentation

## Support

For support, please:
1. Check the documentation
2. Search existing issues
3. Create a new issue if needed

## Roadmap

Future planned features:
- Mobile app support
- Advanced notification options
- API integration capabilities
- Enhanced analytics

## Acknowledgments

Special thanks to all contributors and the open-source community.

---

For more information or support, please open an issue or contact the maintainers (hjiangbg@connect.ust.hk).
