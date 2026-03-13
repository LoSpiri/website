const MOON_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>';
const SUN_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>';

function currentTheme() {
  return document.documentElement.getAttribute("data-theme") || "light";
}

function updateToggleIcon() {
  const btn = document.getElementById("theme-toggle-btn");
  if (btn) btn.innerHTML = currentTheme() === "dark" ? SUN_SVG : MOON_SVG;
}

function jsToggleTheme() {
  const next = currentTheme() === "dark" ? "light" : "dark";
  document.documentElement.setAttribute("data-theme", next);
  try { localStorage.setItem("theme", next); } catch (_) { }
  updateToggleIcon();
}

let wasmToggle = null;

function onToggleClick() {
  if (wasmToggle) {
    wasmToggle();
  } else {
    jsToggleTheme();
  }
}

(function loadWasm() {
  const base = document.currentScript && document.currentScript.src
    ? new URL("../wasm/pkg/theme_toggle.js", document.currentScript.src).href
    : "./wasm/pkg/theme_toggle.js";
  import(base)
    .then(function (mod) {
      return mod.default().then(function () {
        mod.init_theme();
        wasmToggle = mod.toggle_theme;
      });
    })
    .catch(function () { });
})();

class SiteHeader extends HTMLElement {
  connectedCallback() {
    const page = this.getAttribute("page") || "";
    const links = [
      { href: "index.html", label: "Home", id: "home" },
      // { href: "projects.html", label: "Projects", id: "projects" },
      // { href: "articles.html", label: "Articles", id: "articles" },
      { href: "miscellaneous.html", label: "Miscellaneous", id: "miscellaneous" },
      { href: "docs/CV_Lorenzo_Spiridioni.pdf", label: "Resume", id: "resume", external: true },
    ];

    const linkItems = links
      .map((link) => {
        const activeClass = link.id === page ? ' class="active"' : "";
        const external = link.external
          ? ' target="_blank" rel="noopener"'
          : "";
        return `<li><a href="${link.href}"${activeClass}${external}>${link.label}</a></li>`;
      })
      .join("\n        ");

    this.innerHTML = `
      <header class="site-header">
        <nav class="nav">
          <div class="nav-brand">
            <a href="index.html" class="nav-name">Lorenzo Spiridioni</a>
            <span class="nav-tagline">Eclectic Engineer</span>
          </div>
          <div class="nav-right">
            <ul class="nav-links">
              ${linkItems}
            </ul>
            <button id="theme-toggle-btn" class="theme-toggle" aria-label="Toggle theme"></button>
          </div>
        </nav>
      </header>
    `;

    updateToggleIcon();
    document.getElementById("theme-toggle-btn")
      .addEventListener("click", onToggleClick);
  }
}

class SiteFooter extends HTMLElement {
  connectedCallback() {
    this.innerHTML = `
      <footer class="site-footer">
        <p>&copy; ${new Date().getFullYear()} Lorenzo Spiridioni. All rights reserved.</p>
        <div class="footer-links">
          <a href="https://github.com/lospiri" target="_blank" rel="noopener">GitHub</a>
          <a href="https://linkedin.com/in/lorenzo-spiridioni" target="_blank" rel="noopener">LinkedIn</a>
        </div>
      </footer>
    `;
  }
}

customElements.define("site-header", SiteHeader);
customElements.define("site-footer", SiteFooter);
