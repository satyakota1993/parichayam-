(function () {
  const SUPPORT_EMAIL = "support@parichayam.co.in";
  const PHONE_DISPLAY = "+91 94401 76078";
  const PHONE_LINK = "tel:+919440176078";
  const WHATSAPP_LINK = "https://wa.me/919440176078";

  function footerHtml() {
    return [
      '<footer class="parichayam-trust-footer">',
      '  <div class="pc-footer-inner">',
      '    <div class="pc-footer-grid">',
      '      <div class="pc-footer-col">',
      '        <div class="pc-footer-brand">Parichayam</div>',
      '        <p class="pc-footer-desc">Arya Vyshya matrimony for Andhra Pradesh and Telangana families, combining lineage-aware matching, family involvement, dedicated matchmakers, and transparent membership policies.</p>',
      '      </div>',
      '      <div class="pc-footer-col">',
      '        <h2>Company</h2>',
      '        <a href="/about.html">About</a>',
      '        <a href="/contact.html">Contact</a>',
      '        <a href="/contact.html#careers">Careers</a>',
      '      </div>',
      '      <div class="pc-footer-col">',
      '        <h2>Legal</h2>',
      '        <a href="/privacy.html">Privacy Policy</a>',
      '        <a href="/terms.html">Terms</a>',
      '        <a href="/refund.html">Refund Policy</a>',
      '      </div>',
      '      <div class="pc-footer-col">',
      '        <h2>Support</h2>',
      '        <a href="/contact.html#help">Help</a>',
      '        <a href="/contact.html#grievance">Grievance Officer</a>',
      '        <a href="/pricing.html#faq">FAQ</a>',
      '      </div>',
      '      <div class="pc-footer-col" id="connect">',
      '        <h2>Connect</h2>',
      '        <a href="' + WHATSAPP_LINK + '" target="_blank" rel="noopener">WhatsApp</a>',
      '        <a href="mailto:' + SUPPORT_EMAIL + '">Email</a>',
      '        <a href="' + PHONE_LINK + '">Phone</a>',
      '        <a href="/contact.html#connect">Instagram</a>',
      '      </div>',
      '    </div>',
      '    <div class="pc-footer-bottom">',
      '      <span>&copy; 2026 Parichayam. All rights reserved.</span>',
      '      <span>GSTIN: To be updated after registration &middot; DPDP Act 2023 ready &middot; ' + PHONE_DISPLAY + '</span>',
      '    </div>',
      '  </div>',
      '</footer>',
    ].join("");
  }

  function ensureFooter() {
    if (document.querySelector(".parichayam-trust-footer")) return;
    document.body.classList.add("pc-has-auto-footer");
    document.body.insertAdjacentHTML("beforeend", footerHtml());
  }

  function ensureCookieBanner() {
    if (!window.localStorage) return;
    if (localStorage.getItem("parichayam_cookie_consent") === "accepted") return;
    if (document.querySelector(".pc-cookie-banner")) return;
    const banner = document.createElement("div");
    banner.className = "pc-cookie-banner";
    banner.setAttribute("role", "region");
    banner.setAttribute("aria-label", "Cookie consent");
    banner.innerHTML = [
      '<p>We use cookies to deliver our service and analyse usage. By using Parichayam, you accept our <a href="/privacy.html#cookies">Cookie Policy</a> and <a href="/privacy.html">Privacy Policy</a>.</p>',
      '<div class="pc-cookie-actions">',
      '  <button type="button" data-cookie-accept>Accept</button>',
      '  <a href="/privacy.html#cookies">Customize</a>',
      '</div>',
    ].join("");
    document.body.appendChild(banner);
    window.setTimeout(function () {
      banner.classList.add("show");
    }, 150);
    banner.querySelector("[data-cookie-accept]").addEventListener("click", function () {
      localStorage.setItem("parichayam_cookie_consent", "accepted");
      banner.classList.remove("show");
      window.setTimeout(function () {
        banner.remove();
      }, 250);
    });
  }

  function boot() {
    ensureFooter();
    ensureCookieBanner();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
