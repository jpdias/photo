const ejs = require('ejs');
const fs = require('fs');
const path = require('path');

// Create dist directory if it doesn't exist
const distDir = path.join(__dirname, 'dist');
if (!fs.existsSync(distDir)) {
  fs.mkdirSync(distDir, { recursive: true });
}

// Load portfolio data
const portfolioData = JSON.parse(fs.readFileSync(path.join(__dirname, 'data/portfolio.json'), 'utf8'));

// Build main index.html
async function buildIndex() {
  try {
    const template = fs.readFileSync(path.join(__dirname, 'templates/index.ejs'), 'utf8');
    const html = await ejs.render(template, portfolioData);
    fs.writeFileSync(path.join(distDir, 'index.html'), html);
    console.log('✅ Built index.html');
  } catch (error) {
    console.error('❌ Error building index.html:', error);
  }
}

async function buildAboutMe() {
  try {
    const template = fs.readFileSync(path.join(__dirname, 'templates/about_me.ejs'), 'utf8');
    const html = await ejs.render(template, portfolioData);
    fs.writeFileSync(path.join(distDir, 'about_me.html'), html);
    console.log('✅ Built about_me.html');
  } catch (error) {
    console.error('❌ Error building about_me.html:', error);
  }
}

async function buildContact() {
  try {
    const template = fs.readFileSync(path.join(__dirname, 'templates/contact.ejs'), 'utf8');
    const html = await ejs.render(template, portfolioData);
    fs.writeFileSync(path.join(distDir, 'contact.html'), html);
    console.log('✅ Built contact.html');
  } catch (error) {
    console.error('❌ Error building contact.html:', error);
  }
}

// Copy static assets
function copyAssets() {
  const assetsDir = path.join(__dirname, 'assets');
  const distAssetsDir = path.join(distDir, 'assets');
  
  if (fs.existsSync(assetsDir)) {
    if (!fs.existsSync(distAssetsDir)) {
      fs.mkdirSync(distAssetsDir, { recursive: true });
    }
    
    const files = fs.readdirSync(assetsDir);
    files.forEach(file => {
      fs.copyFileSync(path.join(assetsDir, file), path.join(distAssetsDir, file));
    });
    console.log('✅ Copied assets');
  }
  
  // Copy CSS and JS files
  const staticFiles = ['style.css', 'fade_in.js', 'menu.js'];
  staticFiles.forEach(file => {
    const srcPath = path.join(__dirname, file);
    const distPath = path.join(distDir, file);
    
    if (fs.existsSync(srcPath)) {
      fs.copyFileSync(srcPath, distPath);
      console.log(`✅ Copied ${file}`);
    } else {
      console.warn(`⚠️ ${file} not found`);

      process.exit(1);
    }
  });
}

// Generate sitemap.xml
function generateSitemap() {
  const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>https://jpdias.me/photo/</loc>
    <lastmod>${new Date().toISOString().split('T')[0]}</lastmod>
    <priority>1.0</priority>
  </url>
  <url>
    <loc>https://jpdias.me/photo/about_me.html</loc>
    <lastmod>${new Date().toISOString().split('T')[0]}</lastmod>
    <priority>0.8</priority>
  </url>
  <url>
    <loc>https://jpdias.me/photo/contact.html</loc>
    <lastmod>${new Date().toISOString().split('T')[0]}</lastmod>
    <priority>0.8</priority>
  </url>
</urlset>`;
  
  fs.writeFileSync(path.join(distDir, 'sitemap.xml'), sitemap);
  console.log('✅ Generated sitemap.xml');
}

// Generate robots.txt
function generateRobots() {
  const robots = `User-agent: *
Allow: /

Sitemap: https://jpdias.me/photo/sitemap.xml`;
  
  fs.writeFileSync(path.join(distDir, 'robots.txt'), robots);
  console.log('✅ Generated robots.txt');
}

// Main build function
async function build() {
  console.log('🚀 Building Sophia Williams Portfolio...\n');
  
  await buildIndex();
  await buildAboutMe();
  await buildContact();
  copyAssets();
  generateSitemap();
  generateRobots();
  
  console.log('\n✨ Build completed successfully!');
  console.log(`📁 Files generated in: ${distDir}`);
  console.log('🔗 Ready for deployment to GitHub Pages');
  
  // Display build statistics
  console.log('\n📊 Build Statistics:');
  console.log(`   Photos: ${portfolioData.photos.length}`);
  console.log(`   Featured: ${portfolioData.photos.filter(p => p.featured).length}`);
  console.log(`   Categories: ${[...new Set(portfolioData.photos.map(p => p.category))].length}`);
  console.log(`   Locations: ${[...new Set(portfolioData.photos.map(p => p.location))].length}`);
  console.log(`   Pages: index.html, contact.html`);
}

// Run build
build().catch(console.error);