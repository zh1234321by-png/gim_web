import { PageShell } from "../components/SiteChrome";
import content from "../../content/site-content.json";

export default function PublicationsPage() {
  const years = Array.from(new Set(content.publications.map((item) => item.year)));
  return <PageShell><main>
    <section className="page-hero publications-page-hero"><p className="eyebrow"><span /> PUBLICATIONS / OUTPUT</p><h1>学术成果</h1><p>围绕全球电离层建模、空间天气、GNSS 遥感与 InSAR 应用形成持续研究产出。</p></section>
    <section className="page-section publication-list">
      {years.map((year) => <section key={year}><div className="publication-year"><span>{year}</span><i /></div><div>{content.publications.filter((item) => item.year === year).map((item, index) => <article key={item.title}>
        <span className="pub-index">{String(index + 1).padStart(2,"0")}</span><div><h2>{item.title}</h2><p>{item.authors}</p><div className="journal-row"><strong>{item.journal}</strong><span>{item.tag}</span></div></div>
      </article>)}</div></section>)}
    </section>
    <section className="page-section publication-note"><strong>说明</strong><p>本页展示代表性成果。完整成果列表、作者顺序与期刊信息请以陈鹏老师在学院官网的个人主页为准。</p><a href={content.site.teacherProfile} target="_blank" rel="noreferrer">查看官方成果列表 ↗</a></section>
  </main></PageShell>;
}
