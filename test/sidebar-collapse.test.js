const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const publicDir = path.join(__dirname, '../src/web/public');

describe('Chrono sidebar clock collapse', () => {
  it('exposes a brand toggle with a live clock host', () => {
    const html = fs.readFileSync(path.join(publicDir, 'index.html'), 'utf8');
    assert.match(html, /id="sidebarToggle"/);
    assert.match(html, /id="sidebarClock"/);
    assert.match(html, /id="sidebarPanel"/);
    assert.match(html, /aria-controls="sidebarPanel"/);
    assert.match(html, /class="sidebar-brand-chevron"/);
  });

  it('persists collapse and drives analog clock hands', () => {
    const js = fs.readFileSync(path.join(publicDir, 'app.js'), 'utf8');
    assert.match(js, /chrono_sidebar_collapsed/);
    assert.match(js, /function applySidebarCollapsed/);
    assert.match(js, /function wireSidebarToggle/);
    assert.match(js, /function analogClockSvgHtml/);
    assert.match(js, /function startAnalogClocks/);
    assert.match(js, /classList\.toggle\('is-collapsed'/);
  });

  it('collapses the full sidebar off the page', () => {
    const css = fs.readFileSync(path.join(publicDir, 'styles.css'), 'utf8');
    assert.match(css, /\.sidebar\.is-collapsed \.sidebar-panel/);
    assert.match(css, /\.brand-clock/);
    assert.match(css, /#app\.app-shell\.sidebar-collapsed \.workspace/);
  });
});

describe('Chrono login clock face', () => {
  it('molds the sign-in form into the clock dial', () => {
    const js = fs.readFileSync(path.join(publicDir, 'app.js'), 'utf8');
    assert.match(js, /class="login-face"/);
    assert.match(js, /id="loginHandsMask"/);
    assert.match(js, /mask="url\(#loginHandsMask\)"/);
    const css = fs.readFileSync(path.join(publicDir, 'styles.css'), 'utf8');
    assert.match(css, /\.login-face \{/);
    assert.match(css, /\.login-clock-well \{[\s\S]*?fill: #08162a/);
    assert.doesNotMatch(css, /\.login-panel \{[\s\S]{0,400}background:\s*linear-gradient\(165deg, rgba\(255, 255, 255/);
  });
});
