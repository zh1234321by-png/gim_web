import { PageShell } from "../components/SiteChrome";
import content from "../../content/site-content.json";

export default function ResearchPage() {
  return <PageShell><main>
    <section className="page-hero research-page-hero"><p className="eyebrow"><span /> RESEARCH / SCIENCE</p><h1>研究地球空间环境的<br />结构、变化与影响</h1><p>以 GNSS 为核心，联合多源空间大地测量观测与智能算法，推进从科学问题到产品服务的完整链路。</p></section>
    <section className="page-section research-detail-list">{content.researchAreas.map((item) => <article key={item.code}>
      <div className="detail-index">{item.code}</div><div><p>{item.en}</p><h2>{item.title}</h2></div><p>{item.description}</p><div className="tag-row">{item.keywords.map((tag) => <span key={tag}>{tag}</span>)}</div>
    </article>)}</section>
    <section className="page-section projects-section">
      <div className="section-heading"><p className="section-kicker">FUNDED PROJECTS · 科研项目</p><h2>以持续研究回答关键科学问题</h2></div>
      <div className="timeline-list">{content.projects.map((project) => <article key={project.title}><time>{project.period}</time><div><h3>{project.title}</h3><p>{project.source}</p></div><span className={project.status === "在研" ? "status-active" : ""}>{project.status}</span></article>)}</div>
    </section>
    <section className="page-section method-band"><div><span>OBSERVE</span><strong>多源观测</strong></div><i>→</i><div><span>MODEL</span><strong>严密建模</strong></div><i>→</i><div><span>VALIDATE</span><strong>交叉验证</strong></div><i>→</i><div><span>SERVE</span><strong>产品服务</strong></div></section>
  </main></PageShell>;
}
