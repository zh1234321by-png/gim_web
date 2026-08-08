"use client"; // 必须添加，因为使用了 useEffect 和 useRef

import Link from "next/link";
import { useEffect, useRef } from "react";
import content from "../content/site-content.json";
import { PageShell } from "./components/SiteChrome";
import ProductSearch from "./components/ProductSearch";
import TecMap from "./components/TecMap";

export default function Home() {
  // 用于存储所有 section 的 ref（可省略，直接用 querySelector）
  const mainRef = useRef<HTMLElement>(null);

 useEffect(() => {
  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        const el = entry.target;
        if (entry.isIntersecting) {
          // 进入视口：若处于退出状态，先重置到初始位置（无过渡）
          if (el.classList.contains('exiting')) {
            el.style.transition = 'none';
            el.style.transform = 'translateY(40px)';
            el.style.opacity = '0';
            void el.offsetHeight; // 强制重排
            el.style.transition = '';
            el.style.transform = '';
            el.style.opacity = '';
            el.classList.remove('exiting');
          }
          el.classList.add('visible');
        } else {
          // 离开视口：若当前可见，切换为退出状态
          if (el.classList.contains('visible')) {
            el.classList.remove('visible');
            el.classList.add('exiting');
          }
        }
      });
    },
    {
      threshold: 0.15,
      rootMargin: '0px 0px -50px 0px',
    }
  );

  document.querySelectorAll('.section-animate').forEach((el) => observer.observe(el));
  return () => observer.disconnect();
}, []);
  return (
    <PageShell>
      <main ref={mainRef}>
        {/* 1. Hero 区 */}
        <section className="hero section-animate" style={{ transitionDelay: "0.1s" }}>
          <div className="hero-orbit orbit-one" /><div className="hero-orbit orbit-two" />
          <div className="hero-content">
            <p className="eyebrow"><span /> XI&apos;AN · CHINA / 34.23°N 108.93°E</p>
            <h1><span>观测地球之上</span><br />每一个电子的流动</h1>
            <p className="hero-lead">{content.site.description}</p>
            <div className="hero-actions">
              <Link className="button primary" href="/products">访问数据产品 <span>→</span></Link>
              <Link className="button ghost" href="/team">了解课题组团队</Link>
            </div>
          </div>
          <div className="hero-signal" aria-hidden="true">
            <div className="signal-label"><span>SEGM / SIGNAL 01</span><b>ACTIVE</b></div>
            <div className="signal-rings"><i /><i /><i /><em /></div>
            <div className="signal-stats"><span>GNSS</span><span>VTEC</span><span>IONEX</span></div>
          </div>
          <div className="hero-index">01 <span>/ 06</span></div>
        </section>

        {/* 2. Metrics 区 */}
        <section className="metrics-strip section-animate" style={{ transitionDelay: "0.2s" }} aria-label="课题组概况">
          {content.metrics.map((item) => (
            <div key={item.label}><strong>{item.value}</strong><span>{item.label}</span></div>
          ))}
        </section>

        {/* 3. 产品检索区 */}
        <section className="home-products section-pad section-animate" style={{ transitionDelay: "0.3s" }}>
          <div className="section-heading split-heading">
            <div><p className="section-kicker">DATA SERVICES · 数据服务</p><h2>从观测到产品，<br />让电离层数据触手可及</h2></div>
            <p>参考 IGS 数据中心的检索逻辑，按产品类型和日期快速定位 XUST 全球电离层图与 DCB 产品。</p>
          </div>
          <ProductSearch condensed />
        </section>

        {/* 4. 实时地图区 */}
        <section className="realtime-section section-pad section-animate" style={{ transitionDelay: "0.4s" }}>
          <div className="section-heading split-heading light-heading">
            <div><p className="section-kicker">LIVE IONOSPHERE · 实时窗口</p><h2>全球电离层<br />总电子含量</h2></div>
            <div className="live-copy"><span className="live-pill"><i /> IONO00XAN1 实时数据流</span><p>地图沿用课题组 GIMdisplay 的全球等经纬投影、Turbo TEC 色带与高精度海岸线。后台实时接收 IGS SSR 4076.201，并将球谐系数展开为 2.5° × 5° GIM；点击网格可查看该点时间序列。</p></div>
          </div>
          <div className="realtime-frame">
            <div className="frame-top"><span>XUST / GLOBAL VTEC · LIVE</span><span>LAT 87.5° → −87.5° · LON −180° → 180°</span></div>
            <TecMap />
            <div className="frame-meta"><span>MODEL <strong>SEGM-GIM</strong></span><span>RESOLUTION <strong>2.5° × 5°</strong></span><span>HEIGHT <strong>450 KM</strong></span><Link href="/observatory">进入完整观测台 →</Link></div>
          </div>
        </section>

        {/* 5. 科研方向区 */}
        <section className="research-preview section-pad section-animate" style={{ transitionDelay: "0.5s" }}>
          <div className="section-heading"><p className="section-kicker">RESEARCH FOCUS · 科研方向</p><h2>跨越近地空间与地表形变的<br />多尺度观测研究</h2></div>
          <div className="research-grid">
            {content.researchAreas.map((item) => (
              <article key={item.code}>
                <div className="research-no">{item.code}</div><p>{item.en}</p><h3>{item.title}</h3><div className="research-line" /><p className="research-desc">{item.description}</p>
                <div className="tag-row">{item.keywords.map((tag) => <span key={tag}>{tag}</span>)}</div>
              </article>
            ))}
          </div>
          <Link className="text-link" href="/research">查看研究项目与方法 →</Link>
        </section>

        {/* 6. 最新成果区 */}
       
        {/* 7. 新闻动态区 */}
        <section className="news-section section-pad section-animate" style={{ transitionDelay: "0.7s" }}>
         
        </section>
      </main>
    </PageShell>
  );
}