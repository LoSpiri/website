# Lorenzo Spiri — Portfolio

Personal portfolio website built with plain HTML & CSS, designed for GitHub Pages.

## Setup

1. Replace placeholder content in `index.html` with your real information
2. Replace the portrait placeholder with a real image (see below)
3. Push to a GitHub repository named `<username>.github.io`
4. Enable GitHub Pages in the repository settings (deploy from `main` branch)

## Adding a portrait image

1. Add your photo to an `img/` folder (e.g. `img/portrait.jpg`)
2. In `index.html`, replace the `<div class="portrait-placeholder">` element with:
   ```html
   <img src="img/portrait.jpg" alt="Portrait of Lorenzo Spiri" class="portrait-img">
   ```
3. The `.portrait-img` class is already styled in `css/style.css` (see below). Add this if needed:
   ```css
   .portrait-img {
     width: 100px;
     height: 100px;
     border-radius: 50%;
     object-fit: cover;
   }
   ```

## Structure

```
├── index.html       # Main page
├── css/
│   └── style.css    # All styles
└── README.md
```
