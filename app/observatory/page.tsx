import { PageShell } from "../components/SiteChrome";
import ObservatoryConsole from "../components/ObservatoryConsole";

export default function ObservatoryPage() {
  return <PageShell theme="dark"><main className="observatory-main">
    <section className="observatory-head"><div><p>SEGM IONOSPHERE OBSERVATORY / CONTROL SURFACE</p><h1>全球电离层实时观测台</h1></div><div className="observatory-source"><span>NTRIP CASTER</span><strong>IONO00XAN1</strong></div></section>
    <ObservatoryConsole />
    <section className="demo-warning realtime-note"><strong>数据说明</strong><span>地图由 IGS SSR 4076.201 VTEC 球谐系数实时展开；若后台接收程序暂未运行，界面会自动显示最近的真实 SSR 样例并标注 SAMPLE，不再生成模拟电离层场。</span></section>
  </main></PageShell>;
}
