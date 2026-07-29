// Structural checks over the built extensions in dist/.
// Every check is an assertion: a failing probe fails the process, so CI gates on it.
const fs = require('fs');
const path = require('path');

// Prints "  <label>: Yes/No" and returns the boolean, so callers can fold results.
function check(label, ok) {
  console.log(`   ${label}: ${ok ? 'Yes' : 'No'}`);
  return ok;
}

function testManifestStructure(browser) {
  console.log(`\n🔍 Testing ${browser} extension structure...`);

  const buildDir = `dist/${browser}`;
  const manifestPath = path.join(buildDir, 'manifest.json');

  try {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    const results = [];

    console.log(`   Manifest version: ${manifest.manifest_version}`);

    if (browser === 'chrome') {
      results.push(check('Manifest V3', manifest.manifest_version === 3));
      results.push(check('Background service worker', Boolean(manifest.background?.service_worker)));
      results.push(check('Action', Boolean(manifest.action)));
      results.push(check('Host permissions', (manifest.host_permissions || []).length > 0));
    } else {
      results.push(check('Manifest V2', manifest.manifest_version === 2));
      results.push(check('Background scripts', (manifest.background?.scripts || []).length > 0));
      results.push(check('Browser action', Boolean(manifest.browser_action)));
      results.push(check('Gecko ID', Boolean(manifest.applications?.gecko?.id)));
    }

    results.push(check('Permissions', (manifest.permissions || []).length > 0));
    results.push(check('Content scripts', (manifest.content_scripts || []).length > 0));

    // The polyfill is copied from node_modules by build.js, so a missing file here
    // means the build step silently skipped it.
    const polyfillRelPath = 'src/polyfill/browser-polyfill.min.js';
    results.push(check('WebExtension polyfill', fs.existsSync(path.join(buildDir, polyfillRelPath))));
    results.push(check('Polyfill in content scripts',
      Boolean(manifest.content_scripts?.[0]?.js?.includes(polyfillRelPath))));
    if (browser === 'firefox') {
      results.push(check('Polyfill in background',
        Boolean(manifest.background?.scripts?.includes(polyfillRelPath))));
    }

    const passed = results.every(Boolean);
    console.log(passed
      ? `✅ ${browser} extension structure looks good!`
      : `❌ ${browser} extension structure has failing checks`);
    return passed;

  } catch (error) {
    console.error(`❌ Error testing ${browser} extension:`, error.message);
    return false;
  }
}

const usesBrowserAPI = (s) => s.includes('browser.') || s.includes('globalThis.browser');

const SCRIPT_TESTS = [
  {
    label: 'background script',
    relPath: 'src/background/background.js',
    probes: [
      ['Uses browser API', usesBrowserAPI],
      ['Has connection manager', (s) => s.includes('ConnectionManager')],
      ['Has browser detection', (s) =>
        s.includes('browserInfo') || s.includes('isFirefox') || s.includes('isServiceWorker')],
      ['Has WebSocket management', (s) => s.includes('WebSocket') && s.includes('connect')],
    ],
  },
  {
    label: 'content script',
    relPath: 'src/content/content.js',
    probes: [
      ['Uses browser API', usesBrowserAPI],
      ['Has message handling', (s) => s.includes('onMessage') && s.includes('sendResponse')],
    ],
  },
  {
    label: 'popup script',
    relPath: 'src/popup/popup.js',
    probes: [
      ['Uses browser API', usesBrowserAPI],
      ['Has API abstraction', (s) =>
        s.includes('runtimeAPI') || s.includes('tabsAPI') || s.includes('storageAPI')],
    ],
  },
];

function testScript(browser, { label, relPath, probes }) {
  console.log(`\n🔍 Testing ${browser} ${label}...`);

  try {
    const script = fs.readFileSync(path.join(`dist/${browser}`, relPath), 'utf8');
    const passed = probes
      .map(([name, probe]) => check(name, probe(script)))
      .every(Boolean);

    console.log(passed
      ? `✅ ${browser} ${label} looks good!`
      : `❌ ${browser} ${label} has failing checks`);
    return passed;

  } catch (error) {
    console.error(`❌ Error testing ${browser} ${label}:`, error.message);
    return false;
  }
}

function runAllTests() {
  console.log('🚀 Testing cross-browser extension compatibility...\n');

  const browsers = ['chrome', 'firefox'];
  let allPassed = true;

  for (const browser of browsers) {
    console.log(`\n🌐 Testing ${browser.toUpperCase()} extension:`);
    console.log('='.repeat(40));

    if (!testManifestStructure(browser)) {
      allPassed = false;
    }
    for (const scriptTest of SCRIPT_TESTS) {
      if (!testScript(browser, scriptTest)) {
        allPassed = false;
      }
    }
  }

  console.log('\n' + '='.repeat(50));
  if (!allPassed) {
    console.log('❌ Some tests failed. Please check the output above.');
    process.exit(1);
  }

  console.log('🎉 All tests passed! Cross-browser extension is ready.');
  console.log('\n📦 Distribution packages:');
  console.log('   Chrome: dist/opendia-chrome.zip');
  console.log('   Firefox: dist/opendia-firefox.zip');
  console.log('\n🧪 Manual testing:');
  console.log('   1. Chrome: Load dist/chrome in chrome://extensions');
  console.log('   2. Firefox: Load dist/firefox in about:debugging');
  console.log('   3. Both should connect to MCP server on localhost:5555/5556');
}

runAllTests();
