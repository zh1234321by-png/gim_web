import Link from "next/link";
import { PageShell } from "../components/SiteChrome";
import TecMap from "../components/TecMap";
import ProductSearch from "../components/ProductSearch";

export default function ObservatoryPage() {
  return <PageShell theme="dark"><main className="observatory-main">
    <section className="observatory-head"><div><p>SEGM IONOSPHERE OBSERVATORY / CONTROL SURFACE</p><h1>全球电离层实时观测台</h1></div><div className="system-status"><i /> SYSTEM DEMO <span>实时源待接入</span></div></section>
    <section className="dashboard-grid">
      <div className="dashboard-map panel-dark"><div className="panel-title"><span>VTEC GLOBAL MAP</span><span>MODEL · SEGM-GIM / DEMO</span></div><TecMap compact /></div>
      <aside className="space-metrics">
        <article><span>F10.7</span><strong>142.6</strong><small>sfu · DEMO</small><i style={{"--fill":"68%"} as React.CSSProperties} /></article>
        <article><span>Kp INDEX</span><strong>3−</strong><small>QUIET · DEMO</small><i style={{"--fill":"36%"} as React.CSSProperties} /></article>
        <article><span>GLOBAL MAX</span><strong>67.4</strong><small>TECU · DEMO</small><i style={{"--fill":"74%"} as React.CSSProperties} /></article>
        <article><span>LATENCY</span><strong>—</strong><small>WAITING FOR SOURCE</small><i style={{"--fill":"12%"} as React.CSSProperties} /></article>
      </aside>
      <div className="dashboard-search panel-dark"><div className="panel-title"><span>PRODUCT ACCESS</span><Link href="/products">FULL CATALOGUE →</Link></div><ProductSearch condensed /></div>
      <div className="dashboard-log panel-dark"><div className="panel-title"><span>PIPELINE STATUS</span><span>UTC+0</span></div><div className="log-lines"><p><time>08:00:00</time><i className="ok" /> VIEWER INITIALIZED</p><p><time>08:00:01</time><i className="ok" /> DEMO FIELD GENERATED</p><p><time>08:00:02</time><i className="wait" /> REAL-TIME ENDPOINT PENDING</p><p><time>08:00:03</time><i className="ok" /> ARCHIVE CLOUD AVAILABLE</p></div></div>
    </section>
    <section className="demo-warning"><strong>演示说明</strong><span>当前地图和空间天气指数为界面演示数据，不用于科学分析。实时数据接口配置后可替换为真实观测流。</span></section>
  </main></PageShell>;
}
