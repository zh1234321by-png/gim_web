import { PageShell } from "../components/SiteChrome";
import content from "../../content/site-content.json";

export default function TeamPage() {
  return <PageShell><main>
    <section className="page-hero team-page-hero"><p className="eyebrow"><span /> PEOPLE / SEGM</p><h1>在开放协作中<br />训练严谨的研究者</h1><p>课题组重视基础理论、工程实践与国际视野，欢迎对 GNSS、电离层、空间天气和 InSAR 感兴趣的同学加入。</p></section>
    <section className="page-section leader-section">
      <div className="leader-monogram"><span>CP</span><i>PRINCIPAL INVESTIGATOR</i></div>
      <div><p className="section-kicker">GROUP LEADER · 课题组负责人</p><h2>{content.leader.name}</h2><h3>{content.leader.title}</h3><p className="leader-bio">{content.leader.bio}</p><div className="interest-list">{content.leader.interests.map((item) => <span key={item}>{item}</span>)}</div><a className="text-link" href={content.site.teacherProfile} target="_blank" rel="noreferrer">查看学院官方主页 ↗</a></div>
      <aside><span>ACADEMIC SERVICE</span>{content.leader.roles.map((role) => <p key={role}>{role}</p>)}</aside>
    </section>
    <section className="page-section students-section">
      <div className="section-heading split-heading"><div><p className="section-kicker">MEMBERS · 在读成员</p><h2>共同探索，彼此成就</h2></div><p>成员名单依据学院公开主页整理；正式招生与培养信息以学校发布为准。</p></div>
      <div className="cohort-grid">{content.students.map((group) => <article key={group.cohort}><span>{group.cohort}</span><h3>{group.names.join(" · ")}</h3><p>{group.note}</p></article>)}</div>
    </section>
    <section className="page-section join-section"><div><p className="section-kicker">JOIN US · 招生合作</p><h2>把好奇心带到真实数据中</h2></div><p>欢迎测绘、遥感、地理信息、计算机、数学等相关背景的同学联系。来信可简要介绍研究兴趣、专业基础与希望参与的方向。</p><a>联系课题组：{content.site.email}</a></section>
  </main></PageShell>;
}
