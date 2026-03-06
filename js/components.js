class SiteHeader extends HTMLElement {
  connectedCallback() {
    const page = this.getAttribute("page") || "";
    const links = [
      { href: "index.html", label: "Home", id: "home" },
      // { href: "projects.html", label: "Projects", id: "projects" },
      // { href: "articles.html", label: "Articles", id: "articles" },
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
          <ul class="nav-links">
            ${linkItems}
          </ul>
        </nav>
      </header>
    `;
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
