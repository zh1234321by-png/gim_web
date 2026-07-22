import Link from "next/link";
import content from "../content/site-content.json";
import { PageShell } from "./components/SiteChrome";
import ProductSearch from "./components/ProductSearch";
import TecMap from "./components/TecMap";

export default function Home() {
  return (
    <PageShell>
      <main>
        <section className="hero">
          <div className="hero-orbit orbit-one" /><div className="hero-orbit orbit-two" />
          <div className="hero-content">
            <p className="eyebrow"><span /> XI&apos;AN · CHINA / 34.23°N 108.93°E</p>
            <h1><span>观测地球之上</span><br />每一个电子的流动</h1>
            <p className="hero-lead">{content.site.description}</p>
            <div className="hero-actions">
              <Link className="button primary" href="/products">访问数据产品 <span>→</span></Link>
              <Link className="button ghost" href="/research">了解科研方向</Link>
            </div>
          </div>
          <div className="hero-signal" aria-hidden="true">
            <div className="signal-label"><span>SEGM / SIGNAL 01</span><b>ACTIVE</b></div>
            <div className="signal-rings"><i /><i /><i /><em /></div>
            <div className="signal-stats"><span>GNSS</span><span>VTEC</span><span>IONEX</span></div>
          </div>
          <div className="hero-index">01 <span>/ 06</span></div>
        </section>

        <section className="metrics-strip" aria-label="课题组概况">
          {content.metrics.map((item) => <div key={item.label}><strong>{item.value}</strong><span>{item.label}</span></div>)}
        </section>

        <section className="home-products section-pad">
          <div className="section-heading split-heading">
            <div><p className="section-kicker">DATA SERVICES · 数据服务</p><h2>从观测到产品，<br />让电离层数据触手可及</h2></div>
            <p>参考 IGS 数据中心的检索逻辑，按产品类型和日期快速定位 XUST 全球电离层图与 DCB 产品。</p>
          </div>
          <ProductSearch condensed />
        </section>

        <section className="realtime-section section-pad">
          <div className="section-heading split-heading light-heading">
            <div><p className="section-kicker">LIVE IONOSPHERE · 实时窗口</p><h2>全球电离层<br />总电子含量</h2></div>
            <div className="live-copy"><span className="live-pill"><i /> 演示数据流</span><p>展示逻辑延续课题组现有 GIMdisplay：全球等经纬投影、连续 TEC 色带、历元控制。实时产品源接入后可直接切换。</p></div>
          </div>
          <div className="realtime-frame">
            <div className="frame-top"><span>XUST / GLOBAL VTEC</span><span>LAT 87.5° → -87.5° · LON -180° → 180°</span></div>
            <TecMap />
            <div className="frame-meta"><span>MODEL <strong>SEGM-GIM</strong></span><span>RESOLUTION <strong>2.5° × 5°</strong></span><span>HEIGHT <strong>450 KM</strong></span><Link href="/observatory">进入完整观测台 →</Link></div>
          </div>
        </section>

        <section className="research-preview section-pad">
          <div className="section-heading"><p className="section-kicker">RESEARCH FOCUS · 科研方向</p><h2>跨越近地空间与地表形变的<br />多尺度观测研究</h2></div>
          <div className="research-grid">
            {content.researchAreas.map((item) => <article key={item.code}>
              <div className="research-no">{item.code}</div><p>{item.en}</p><h3>{item.title}</h3><div className="research-line" /><p className="research-desc">{item.description}</p>
              <div className="tag-row">{item.keywords.map((tag) => <span key={tag}>{tag}</span>)}</div>
            </article>)}
          </div>
          <Link className="text-link" href="/research">查看研究项目与方法 →</Link>
        </section>

        <section className="publication-feature section-pad">
          <div className="feature-number">2026</div>
          <div className="feature-copy">
            <p className="section-kicker">SELECTED PUBLICATION · 最新成果</p>
            <h2>{content.publications[0].title}</h2>
            <p>{content.publications[0].authors}</p>
            <div><strong>{content.publications[0].journal}</strong><span>{content.publications[0].tag}</span></div>
          </div>
          <Link className="feature-arrow" href="/publications" aria-label="查看学术成果">↗</Link>
        </section>

        <section className="news-section section-pad">
          <div className="section-heading"><p className="section-kicker">LATEST · 团队动态</p><h2>最新进展</h2></div>
          <div className="news-list">{content.news.map((item) => <div key={item.date + item.title}><time>{item.date}</time><span>{item.type}</span><strong>{item.title}</strong><i>↗</i></div>)}</div>
        </section>
      </main>
    </PageShell>
  );
}
