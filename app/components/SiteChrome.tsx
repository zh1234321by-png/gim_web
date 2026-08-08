import Link from "next/link";
import content from "../../content/site-content.json";

const nav = [
  ["/", "首页"],
  ["/products", "数据产品"],
  ["/research", "科研方向"],
  ["/publications", "学术成果"],
  ["/team", "团队成员"],
  ["/observatory", "实时观测台"],
];

export function Header() {
  return (
    <header className="site-header">
      <div className="header-inner">
        <Link className="brand" href="/" aria-label="SEGM 首页">
          <img src="/segm-logo.svg" width="54" height="54" alt="SEGM课题组标志" />
          <span className="brand-copy">
            <strong>{content.site.shortName}</strong>
            <span>{content.site.nameZh}</span>
          </span>
        </Link>
        <nav className="main-nav" aria-label="主导航">
          {nav.map(([href, label]) => (
            <Link href={href} key={href}>{label}</Link>
          ))}
        </nav>
        <a className="header-action" href={content.site.productCloud} target="_blank" rel="noreferrer">
          产品云 <span aria-hidden="true">↗</span>
        </a>
      </div>
    </header>
  );
}

export function Footer() {
  return (
    <footer className="site-footer">
      <div className="footer-grid">
        <div>
          <div className="footer-brand">
            <img src="/segm-logo.svg" width="58" height="58" alt="" />
            <div><strong>{content.site.shortName}</strong><span>{content.site.nameEn}</span></div>
          </div>
          <p>{content.site.description}</p>
        </div>
        <div>
          <h2>联系与访问</h2>
          <p>{content.site.institution}<br />{content.site.address}<br />{content.site.email}</p>
        </div>
        <div>
          <h2>相关链接</h2>
          <p className="footer-links">
            <a href={content.site.teacherProfile} target="_blank" rel="noreferrer">陈鹏老师主页 ↗</a>
            <a href={content.site.collegeUrl} target="_blank" rel="noreferrer">测绘科学与技术学院 ↗</a>
             
          </p>
        </div>
      </div>
      <div className="footer-bottom">
        <span>© 2026 SEGM · Xi&apos;an University of Science and Technology</span>
        <span>科研信息以学校官方页面为准</span>
      </div>
    </footer>
  );
}

export function PageShell({ children, theme = "light" }: { children: React.ReactNode; theme?: "light" | "dark" }) {
  return <div className={`site-shell ${theme === "dark" ? "dark-shell" : ""}`}><Header />{children}<Footer /></div>;
}
