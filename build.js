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
      console.warn(`⚠️ ${file} not found, creating placeholder...`);
      createPlaceholderFile(file, distPath);
    }
  });
}

function createPlaceholderFile(filename, distPath) {
  if (filename === 'style.css') {
    const css = `
/* Custom styles for Sophia Williams Portfolio */
.animate-fade-in {
  animation: fadeIn 0.5s ease-in forwards;
}

@keyframes fadeIn {
  from { opacity: 0; }
  to { opacity: 1; }
}

.tap-highlight-transparent {
  -webkit-tap-highlight-color: transparent;
}

/* Custom scrollbar for dark mode */
::-webkit-scrollbar {
  width: 8px;
}

::-webkit-scrollbar-track {
  background: transparent;
}

::-webkit-scrollbar-thumb {
  background: rgba(156, 163, 175, 0.5);
  border-radius: 4px;
}

::-webkit-scrollbar-thumb:hover {
  background: rgba(156, 163, 175, 0.8);
}

/* Photo hover effects */
.group:hover .group-hover\\:translate-y-0 {
  transform: translateY(0);
}

/* Responsive improvements */
@media (max-width: 768px) {
  .container {
    padding-left: 1rem;
    padding-right: 1rem;
  }
}
    `;
    fs.writeFileSync(distPath, css);
  } else if (filename === 'fade_in.js') {
    const js = `
// Fade in animation for images
document.addEventListener('DOMContentLoaded', function() {
  const images = document.querySelectorAll('img');
  
  const imageObserver = new IntersectionObserver((entries, observer) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        const img = entry.target;
        img.style.opacity = '1';
        observer.unobserve(img);
      }
    });
  });

  images.forEach(img => {
    imageObserver.observe(img);
  });

  // Body fade in
  document.body.style.opacity = '1';
});
    `;
    fs.writeFileSync(distPath, js);
  } else if (filename === 'menu.js') {
    const js = `
// Mobile menu toggle
function menuToggle() {
  const menu = document.getElementById('menu');
  const ulMenu = document.getElementById('ulMenu');
  
  if (menu.style.height === '0px' || menu.style.height === '') {
    menu.style.height = 'auto';
    const height = menu.scrollHeight;
    menu.style.height = '0px';
    
    setTimeout(() => {
      menu.style.height = height + 'px';
    }, 10);
    
    ulMenu.style.paddingTop = '1rem';
  } else {
    menu.style.height = '0px';
    ulMenu.style.paddingTop = '0px';
  }
}

// Close mobile menu when clicking on a link
document.addEventListener('DOMContentLoaded', function() {
  const menuLinks = document.querySelectorAll('#ulMenu a');
  
  menuLinks.forEach(link => {
    link.addEventListener('click', () => {
      if (window.innerWidth < 768) {
        menuToggle();
      }
    });
  });
});
    `;
    fs.writeFileSync(distPath, js);
  }
}

// Generate sitemap.xml
function generateSitemap() {
  const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>https://your-username.github.io/repository-name/</loc>
    <lastmod>${new Date().toISOString().split('T')[0]}</lastmod>
    <priority>1.0</priority>
  </url>
  <url>
    <loc>https://your-username.github.io/repository-name/about_me.html</loc>
    <lastmod>${new Date().toISOString().split('T')[0]}</lastmod>
    <priority>0.8</priority>
  </url>
  <url>
    <loc>https://your-username.github.io/repository-name/contact.html</loc>
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

Sitemap: https://your-username.github.io/repository-name/sitemap.xml`;
  
  fs.writeFileSync(path.join(distDir, 'robots.txt'), robots);
  console.log('✅ Generated robots.txt');
}

// Main build function
async function build() {
  console.log('🚀 Building Sophia Williams Portfolio...\n');
  
  await buildIndex();
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
}

// Run build
build().catch(console.error);