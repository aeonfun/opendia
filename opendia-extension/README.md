# OpenDia Cross-Browser Extension

A dual-manifest browser extension supporting both Chrome MV3 and Firefox MV2 for comprehensive browser automation through the Model Context Protocol (MCP).

## 🌐 Browser Support

| Browser | Manifest | Background | Connection | Store |
|---------|----------|------------|------------|-------|
| Chrome | V3 | Service Worker | Temporary | Chrome Web Store |
| Firefox | V2 | Background Page | Persistent | Firefox Add-ons |
| Edge | V3 | Service Worker | Temporary | Microsoft Store |
| Safari | - | - | - | Coming Soon |

## 🚀 Quick Start

### Development Setup

```bash
# Install dependencies
npm install

# Build for all browsers
npm run build

# Build for specific browser
npm run build:chrome
npm run build:firefox

# Create distribution packages
npm run package:chrome
npm run package:firefox

# Test builds
node test-extension.js
```

### Installation

#### Chrome/Edge/Brave
1. Build the extension: `npm run build:chrome`
2. Open `chrome://extensions/` (or equivalent)
3. Enable "Developer mode"
4. Click "Load unpacked" and select `dist/chrome`

#### Firefox
1. Build the extension: `npm run build:firefox`
2. Open `about:debugging#/runtime/this-firefox`
3. Click "Load Temporary Add-on"
4. Select any file in `dist/firefox` directory

## 🏗️ Architecture

### Dual-Manifest Strategy

OpenDia uses a dual-manifest approach to maximize browser compatibility:

- **Chrome MV3**: Required for Chrome Web Store, uses service workers
- **Firefox MV2**: Enhanced capabilities, persistent background pages

### Connection Management

```javascript
// Chrome MV3: Temporary connections
class ServiceWorkerManager {
  async ensureConnection() {
    // Create fresh connection for each operation
    await this.createTemporaryConnection();
  }
}

// Firefox MV2: Persistent connections
class BackgroundPageManager {
  constructor() {
    this.persistentSocket = null;
    this.setupPersistentConnection();
  }
}
```

### Cross-Browser Compatibility

The extension uses WebExtension polyfill for consistent API usage:

```javascript
// Polyfill setup
if (typeof browser === 'undefined' && typeof chrome !== 'undefined') {
  globalThis.browser = chrome;
}

// Unified API usage
const tabs = await browser.tabs.query({active: true, currentWindow: true});
```

## 🔧 Build System

### Build Configuration

The build system creates browser-specific packages:

```javascript
// build.js
async function buildForBrowser(browser) {
  // Copy common files
  await fs.copy('src', path.join(buildDir, 'src'));
  
  // Copy browser-specific manifest
  await fs.copy(`manifest-${browser}.json`, path.join(buildDir, 'manifest.json'));
  
  // Copy WebExtension polyfill
  await fs.copy('node_modules/webextension-polyfill/dist/browser-polyfill.min.js',
    path.join(buildDir, 'src/polyfill/browser-polyfill.min.js'));
}
```

### Build Validation

```bash
# Validate all builds
npm run build && node build.js validate

# Check specific browser
node build.js validate chrome
node build.js validate firefox
```

## 🧪 Testing

### Automated Testing

```bash
# Run comprehensive tests
node test-extension.js

# Test specific components
node test-extension.js --manifest
node test-extension.js --background
node test-extension.js --content
```

### Manual Testing

1. **Connection Test**: Extension popup should show "Connected to MCP server"
2. **Background Tab Test**: Use `tab_list` with `check_content_script: true`
3. **Cross-Browser Test**: Same functionality on both Chrome and Firefox

## 📁 Directory Structure

```
opendia-extension/
├── src/
│   ├── background/
│   │   └── background.js          # Cross-browser background script
│   ├── content/
│   │   └── content.js            # Content script with polyfill
│   ├── popup/
│   │   ├── popup.html            # Extension popup
│   │   └── popup.js              # Popup logic with browser APIs
│   └── polyfill/
│       └── browser-polyfill.min.js # WebExtension polyfill
├── icons/                        # Extension icons
├── dist/                        # Build output
│   ├── chrome/                  # Chrome MV3 build
│   ├── firefox/                 # Firefox MV2 build
│   ├── opendia-chrome.zip       # Chrome package
│   └── opendia-firefox.zip      # Firefox package
├── manifest-chrome.json         # Chrome MV3 manifest
├── manifest-firefox.json        # Firefox MV2 manifest
├── build.js                     # Build system
├── test-extension.js           # Test suite
└── package.json                # Dependencies and scripts
```

## 🔗 Integration

### MCP Server Connection

The extension automatically discovers and connects to the MCP server:

```javascript
// Port discovery
const commonPorts = [5556, 5557, 5558, 3001, 6001, 6002, 6003];
const response = await fetch(`http://localhost:${port}/ports`);
const portInfo = await response.json();
```

A **Custom HTTP Port** set in the popup (saved as `customHttpPort` in
`storage.local`) is checked before this list, for servers started on any other
HTTP port.

### Background Tab Support

All tools support background tab targeting:

```javascript
// Target specific tab
await browser.tabs.sendMessage(tabId, {
  action: 'page_analyze',
  data: { intent_hint: 'login', tab_id: 12345 }
});
```

## 🛠️ Development

### Adding New Features

1. **Cross-Browser First**: Use `browser` API throughout
2. **Connection Aware**: Handle both temporary and persistent connections
3. **Test Both Browsers**: Validate on Chrome and Firefox
4. **Update Both Manifests**: Ensure compatibility

### Browser-Specific Handling

```javascript
// Detect browser environment
const browserInfo = {
  isFirefox: typeof browser !== 'undefined' && browser.runtime.getManifest().applications?.gecko,
  isChrome: typeof chrome !== 'undefined' && !browser.runtime.getManifest().applications?.gecko,
  isServiceWorker: typeof importScripts === 'function',
  manifestVersion: browser.runtime.getManifest().manifest_version
};

// Handle differences
if (browserInfo.isServiceWorker) {
  // Chrome MV3 service worker behavior
} else {
  // Firefox MV2 background page behavior
}
```

### API Compatibility

| Feature | Chrome MV3 | Firefox MV2 | Implementation |
|---------|------------|-------------|----------------|
| Background | Service Worker | Background Page | Connection Manager |
| Script Injection | `browser.scripting` | `browser.tabs.executeScript` | Feature detection |
| Persistent State | ❌ | ✅ | Browser-specific storage |
| WebRequest Blocking | Limited | Full | Firefox advantage |
| Store Distribution | Required | Optional | Both supported |

## 🚀 Distribution

### Chrome Web Store

```bash
# Build and package
npm run package:chrome

# Upload dist/opendia-chrome.zip to Chrome Web Store
```

### Firefox Add-ons (AMO)

```bash
# Build and package
npm run package:firefox

# Upload dist/opendia-firefox.zip to addons.mozilla.org
```

### GitHub Releases

```bash
# Create both packages
npm run package:chrome
npm run package:firefox

# Upload both files to GitHub releases
```

## 🤝 Contributing

1. **Test Both Browsers**: Always test Chrome and Firefox
2. **Use Browser APIs**: Avoid `chrome.*` direct usage
3. **Update Both Manifests**: Keep manifests in sync
4. **Validate Builds**: Run test suite before committing

## 📚 Resources

- [WebExtension API Documentation](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions)
- [Chrome Extension MV3 Guide](https://developer.chrome.com/docs/extensions/mv3/)
- [Firefox Extension Development](https://extensionworkshop.com/)
- [WebExtension Polyfill](https://github.com/mozilla/webextension-polyfill)

## 🔧 Troubleshooting

### Common Issues

1. **Connection Fails**: Check MCP server is running (`npm start` in `opendia-mcp/`)
2. **Chrome Service Worker**: Extensions may need manual restart in `chrome://extensions`
3. **Firefox Temporary**: Extension reloads required after Firefox restart
4. **Build Errors**: Ensure all dependencies installed (`npm install`)

### Debug Commands

```bash
# Check server status
curl http://localhost:5556/ping

# Validate builds
node build.js validate

# Test extension compatibility
node test-extension.js

# Check extension logs
# Chrome: chrome://extensions -> OpenDia -> service worker
# Firefox: about:debugging -> OpenDia -> Inspect
```

## 🎯 Future Enhancements

- [ ] Safari extension support
- [ ] Edge-specific optimizations
- [ ] WebExtension Manifest V3 migration for Firefox
- [ ] Enhanced anti-detection features
- [ ] Performance optimizations for service workers