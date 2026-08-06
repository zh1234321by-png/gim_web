import { PageShell } from "../components/SiteChrome";
import content from "../../content/site-content.json";

export default function PublicationsPage() {
  // 从 publications 数据中提取所有年份，去重后作为分组依据。
  // 这里使用 Set 保证每个年份仅出现一次。
  const years = Array.from(new Set(content.publications.map((item) => item.year)));

  return (
    <PageShell>
      <main>
        {/* 页面 Hero 区：用于展示页面标题、英文标签和简介 */}
        <section className="page-hero publications-page-hero">
          <p className="eyebrow">
            <span /> PUBLICATIONS / OUTPUT
          </p>
          <h1>学术成果</h1>
          <p>
            围绕全球电离层建模、空间天气、GNSS 遥感与 InSAR 应用形成持续研究产出。
          </p>
        </section>

        {/* 按年份分组展示成果列表 */}
        <section className="page-section publication-list">
          {years.map((year) => (
            <section key={year}>
              <div className="publication-year">
                <span>{year}</span>
                <i />
              </div>

              <div>
                {content.publications
                  .filter((item) => item.year === year)
                  .map((item, index) => (
                    <article key={item.title}>
                      {/* 排序索引，格式化为两位数字 */}
                      <span className="pub-index">
                        {String(index + 1).padStart(2, "0")}
                      </span>

                      <div>
                        {/* 论文标题和作者信息 */}
                        <h2>{item.title}</h2>
                        <p>{item.authors}</p>

                        <div className="journal-row">
                          <strong>{item.journal}</strong>
                          <span>{item.tag}</span>

                          {/*
                            如果 publication 对象包含 link 字段，则跳转到该链接。
                            否则退回到教师个人主页。
                          */}
                          <span>
                            <a
                              href={item.link || content.site.teacherProfile}
                              target="_blank"
                              rel="noreferrer"
                            >
                              查看原文
                            </a>
                          </span>
                        </div>
                      </div>
                    </article>
                  ))}
              </div>
            </section>
          ))}
        </section>

        {/* 页面底部附注：提示官方成果列表地址 */}
        <section className="page-section publication-note">
          <strong>说明</strong>
          <p>
            本页展示代表性成果。完整成果列表、作者顺序与期刊信息请以陈鹏老师在学院官网的个人主页为准。
          </p>
          <a
            href={content.site.teacherProfile}
            target="_blank"
            rel="noreferrer"
          >
            查看官方成果列表 ↗
          </a>
        </section>
      </main>
    </PageShell>
  );
}
