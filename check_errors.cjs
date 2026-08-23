const puppeteer = require('puppeteer');
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
    executablePath: '/root/.cache/puppeteer/chrome/linux-127.0.6533.88/chrome-linux64/chrome'
  });
  const page = await browser.newPage();
  const errors = [];
  const consoleMsgs = [];
  page.on('console', msg => consoleMsgs.push(`[${msg.type()}] ${msg.text()}`));
  page.on('pageerror', err => errors.push(`PAGE ERROR: ${err.message}\n${err.stack}`));
  page.on('requestfailed', req => errors.push(`REQUEST FAILED: ${req.url()} - ${req.failure()?.errorText}`));

  await page.goto('http://localhost:3000/', { waitUntil: 'networkidle0', timeout: 15000 });

  // Click login nav button
  const clicked = await page.evaluate(() => {
    const btns = [...document.querySelectorAll('button')];
    const loginBtn = btns.find(b => b.textContent.includes('تسجيل الدخول') || b.textContent.includes('Sign in'));
    if (loginBtn) { loginBtn.click(); return true; }
    return false;
  });
  console.log('Clicked login:', clicked);
  await sleep(1500);

  // Fill credentials
  await page.type('input[id="u"]', 'testuser');
  await page.type('input[id="p"]', 'test1234');
  await page.click('button[type="submit"]');
  await sleep(4000);

  const bodyText = await page.evaluate(() => document.body.innerText.substring(0, 500));
  const rootHTML = await page.evaluate(() => {
    const root = document.getElementById('root');
    return root ? root.innerHTML.substring(0, 2000) : 'NO ROOT';
  });
  
  console.log('=== ERRORS ===');
  errors.forEach(e => console.log(e));
  console.log('=== CONSOLE (last 20) ===');
  consoleMsgs.slice(-20).forEach(m => console.log(m));
  console.log('=== BODY TEXT ===');
  console.log(bodyText || '(empty)');
  console.log('=== ROOT HTML (first 1500) ===');
  console.log(rootHTML.substring(0, 1500));

  await browser.close();
})();
