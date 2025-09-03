# Photography Portfolio

A dynamic photography portfolio website built with EJS templates and deployed automatically to GitHub Pages.

## 🌟 Features

- **Dynamic Content**: Portfolio generated from JSON data
- **Responsive Design**: Works perfectly on desktop and mobile devices
- **Photo Information**: Location and date metadata for each photo
- **Featured Photos**: Highlight your best work
- **Lightbox Gallery**: Beautiful photo viewing experience with Fancybox
- **Statistics**: Automatic calculation of portfolio stats
- **SEO Optimized**: Includes sitemap, robots.txt, and meta tags
- **Auto Deployment**: GitHub Actions automatically builds and deploys

## 🚀 Quick Start

1. **Clone or fork this repository**
   ```bash
   git clone https://github.com/jpdias/photo.git
   cd photo
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Customize your portfolio**
   - Edit `data/portfolio.json` with your information and photos
   - Add any custom assets to the `assets/` folder
   - Modify styling in `style.css` if needed

4. **Build locally**
   ```bash
   npm run build
   ```

5. **Test locally**
   ```bash
   npm run dev
   ```

6. **Deploy to GitHub Pages**
   - Push to the `main` branch
   - Enable GitHub Pages in repository settings
   - The GitHub Action will automatically build and deploy

## 📁 Project Structure

```
├── .github/workflows/
│   └── deploy.yml          # GitHub Actions deployment workflow
├── data/
│   └── portfolio.json      # Your portfolio data and photos
├── templates/
│   └── index.ejs          # Main page template
├── assets/                # Static assets (favicon, etc.)
├── dist/                  # Generated site (auto-created)
├── build.js              # Build script
├── package.json          # Dependencies and scripts
└── README.md            # This file
```

## 🎨 Customizing Your Portfolio

### Adding Photos

Edit `data/portfolio.json` and add your photos to the `photos` array:

```json
{
  "id": "unique-photo-id",
  "url": "https://your-image-url.com/photo.jpg",
  "alt": "Description of the photo",
  "location": "City, Country",
  "date": "2023-12-01",
  "category": "landscape",
  "featured": true
}
```

### Photo Categories

Available categories include:
- `landscape`
- `portrait`  
- `street`
- `nature`
- `wildlife`
- `architecture`
- `urban`
- `cultural`

### Updating Site Information

Modify the `site` section in `data/portfolio.json`:

```json
{
  "site": {
    "title": "Your Name - Portfolio",
    "description": "Your bio and description",
    "author": "Your Name",
    "contact": {
      "address": "Your Address",
      "phone": "Your Phone"
    },
    "social": {
      "facebook": "https://facebook.com/yourprofile",
      "instagram": "https://instagram.com/yourprofile",
      // ... other social links
    }
  }
}
```

## 🔧 Development

### Local Development
```bash
npm run dev
```
This builds the site and starts a local server at `http://localhost:8080`

### Build Only
```bash
npm run build
```

### Clean Build
```bash
npm run clean
npm run build
```

## 🚀 Deployment

### GitHub Pages (Recommended)

1. **Enable GitHub Pages**:
   - Go to repository Settings → Pages
   - Source: GitHub Actions

2. **Push to main branch**:
   ```bash
   git add .
   git commit -m "Update portfolio"
   git push origin main
   ```

3. **Automatic deployment**: The GitHub Action will build and deploy automatically

### Manual Deployment

You can also deploy the `dist/` folder to any static hosting service:
- Netlify
- Vercel
- Firebase Hosting
- AWS S3

## 📊 Features Explained

### Responsive Gallery Layout
The gallery automatically arranges photos in a responsive masonry-style layout with hover effects showing location and date information.

### Featured Photos
Photos marked with `"featured": true` display a yellow "Featured" badge and are highlighted in the portfolio statistics.

### SEO Optimization
- Automatic sitemap generation
- Meta tags for social sharing
- Semantic HTML structure
- Performance optimized images

### Statistics Dashboard
Automatically calculates and displays:
- Total number of photos
- Number of featured photos  
- Countries/locations visited
- Photo categories

## 🎯 Customization Tips

1. **Colors**: Modify Tailwind classes in the EJS template
2. **Layout**: Adjust the grid layout logic in `templates/index.ejs`
3. **Fonts**: Change fonts in the `<head>` section and Tailwind config
4. **Animations**: Customize CSS animations in `style.css`

## 🐛 Troubleshooting

### Build Errors
- Ensure `data/portfolio.json` is valid JSON
- Check that all required fields are present in photo objects
- Verify Node.js version compatibility (18+ recommended)

### Deployment Issues
- Confirm GitHub Pages is enabled with "GitHub Actions" as source
- Check GitHub Actions logs for detailed error messages
- Ensure repository is public (or you have GitHub Pro for private repos)

### Image Issues
- Use high-quality images with appropriate dimensions
- Ensure image URLs are accessible and properly formatted
- Consider using a CDN for better performance

## 📄 License

This project is open source and available under the [MIT License](LICENSE).

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## 📞 Support

If you encounter any issues or need help customizing your portfolio, please open an issue on GitHub.

---

**Built with ❤️ for photographers who want a beautiful, maintainable portfolio website.**