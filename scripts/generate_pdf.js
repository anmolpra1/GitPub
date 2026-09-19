const puppeteer = require('puppeteer-core');
const path = require('path');
const fs = require('fs');

(async () => {
  console.log('🚀 Launching browser...');
  
  const browser = await puppeteer.launch({
    headless: 'new',
    executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const page = await browser.newPage();
  
  const htmlPath = path.resolve(__dirname, '..', 'GitPub_System_Design.html');
  const pdfPath = path.resolve(__dirname, '..', 'GitPub_System_Design.pdf');
  
  console.log('📄 Loading HTML:', htmlPath);
  await page.goto('file:///' + htmlPath.replace(/\\/g, '/'), { 
    waitUntil: 'networkidle0',
    timeout: 60000 
  });

  // Wait for Mermaid diagrams to render
  console.log('⏳ Waiting for Mermaid diagrams...');
  await page.waitForFunction(() => {
    const mermaidDivs = document.querySelectorAll('.mermaid');
    return Array.from(mermaidDivs).every(div => div.querySelector('svg'));
  }, { timeout: 30000 });
  
  // Extra wait for rendering to stabilize
  await new Promise(r => setTimeout(r, 2000));

  console.log('📝 Generating PDF...');
  await page.pdf({
    path: pdfPath,
    format: 'A4',
    printBackground: true,
    margin: {
      top: '20mm',
      bottom: '20mm',
      left: '15mm',
      right: '15mm'
    },
    displayHeaderFooter: true,
    headerTemplate: '<div></div>',
    footerTemplate: `
      <div style="font-size: 9px; color: #999; width: 100%; text-align: center; padding: 0 20px;">
        <span>GitPub System Design</span>
        <span style="float: right;">Page <span class="pageNumber"></span> of <span class="totalPages"></span></span>
      </div>
    `
  });

  await browser.close();
  
  const stats = fs.statSync(pdfPath);
  console.log(`✅ PDF generated: ${pdfPath}`);
  console.log(`📊 Size: ${(stats.size / 1024).toFixed(1)} KB`);
})();
