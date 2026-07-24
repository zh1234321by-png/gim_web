import ProductSearch from "../components/ProductSearch";
import { PageShell } from "../components/SiteChrome";
import content from "../../content/site-content.json";

export default function ProductsPage() {
  return <PageShell><main>
    <section className="page-hero product-page-hero"><p className="eyebrow"><span /> DATA PRODUCTS / XUST</p><h1>电离层产品服务</h1><p>检索、下载并分析 XUST 全球电离层图与差分码偏差产品。5分钟实时 GIM 产品现已正式发布。</p></section>
    <section className="page-section"><ProductSearch /></section>
    <section className="page-section product-cards-section">
      <div className="section-heading"><p className="section-kicker">PRODUCT CATALOGUE · 产品目录</p><h2>标准化产品，面向科研与应用</h2></div>
      <div className="product-cards">
        <article><span>01 / GIM</span><h3>全球电离层图</h3><p>IONEX 1.0 格式，事后产品为1小时时间分辨率，实时产品为5分钟分辨率，采用 IGS 长命名与传统短命名并行发布。</p><dl><div><dt>空间分辨率</dt><dd>2.5° × 5°</dd></div><div><dt>参考高度</dt><dd>450 km</dd></div><div><dt>时效</dt><dd>事后 / 实时</dd></div></dl></article>
        <article><span>02 / DCB</span><h3>差分码偏差</h3><p>Bias-SINEX 标准格式，提供日解卫星与接收机差分码偏差产品。</p><dl><div><dt>格式</dt><dd>BSX</dd></div><div><dt>采样</dt><dd>1 day</dd></div><div><dt>压缩</dt><dd>gzip</dd></div></dl></article>
        <article className="coming-card"><span>03 / RT</span><h3>实时电离层产品</h3><p>按“年份 / 年积日”发布5分钟 GIM、传统短文件名 IONEX 与日 DCB；可在上方检索器直接定位和下载。</p><div className="coming-status"><i /> PIPELINE ONLINE</div></article>
      </div>
    </section>
    <section className="page-section format-section">
      <div><p className="section-kicker">FILE NAMING · 文件命名</p><h2>兼容 IGS 产品规范</h2><p>目录按“年份 / 年积日”组织；主页检索器会自动将公历日期转换为年积日并生成下载地址。</p></div>
      <div className="code-list"><code>XAN1OPSRTS_20262040000_01D_05M_GIM.INX.gz</code><code>XAN0MGXRAP_20262040000_01D_01D_DCB.BSX.gz</code><code>xan26204.ION.gz</code></div>
    </section>
    <section className="page-section tool-banner"><div><p className="section-kicker">ANALYSIS TOOL · 分析工具</p><h2>使用完整 GIMdisplay</h2><p>上传 IONEX 文件，查看 TEC 动画、产品对比、差值统计与时间序列。</p></div><a className="button primary" href="/tools/gim-viewer.html" target="_blank">打开分析工具 ↗</a></section>
    <section className="source-note">产品源：<a href={content.site.productCloud} target="_blank" rel="noreferrer">{content.site.productCloud}</a> · 当前目录状态以产品云为准。</section>
  </main></PageShell>;
}
