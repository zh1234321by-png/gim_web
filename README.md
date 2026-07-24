# SEGM 课题组网站

西安科技大学测绘科学与技术学院空间环境与地质灾害监测课题组网站。

## 页面

- `/`：学术宣传主页、产品快速检索、实时窗口演示
- `/products`：事后 / 实时产品检索与产品说明
- `/research`：科研方向和科研项目
- `/publications`：代表性论文
- `/team`：负责人、成员与招生联系
- `/observatory`：偏数据监控台风格的实时观测页面
- `/tools/gim-viewer.html`：课题组现有 GIMdisplay 完整分析工具

## 更新内容

人员、论文、项目、新闻、联系方式和产品目录统一维护在：

`content/site-content.json`

详细说明见：

`content/内容更新说明.md`

## 产品配置

事后产品目录当前指向：

`http://8.130.47.186/post_iono`

实时产品目录：

`http://8.130.47.186/rt_iono`

实时产品按年份和年积日发布，检索器会生成 5 分钟 GIM、短文件名
IONEX 和日 DCB 的下载地址。

## 本地运行

```powershell
pnpm install
pnpm run dev
```

打开 `http://localhost:3000/`。

构建检查：

```powershell
pnpm run build
```

### Windows 生产模式无样式

Vinext 0.0.50 的静态资源缓存路径在 Windows 下需要将反斜杠统一为 URL
斜杠。项目的 `postinstall` 和 `prestart` 会自动执行兼容修复；停止旧进程后
重新运行 `pnpm start` 即可。若浏览器仍保留无样式页面，请按
`Ctrl + F5` 强制刷新。

实时 API 代理会先完整读取 Python 后台返回的有限 JSON，再交给 Vinext。
这样可以避免 Node 24 在浏览器刷新、断开或慢速读取时，将 Undici 上游响应
流留在暂停状态而触发断言错误。

## 实时观测台

实时观测台已接入 `IONO00XAN1` NTRIP 数据流。后台程序负责解码
IGS SSR 4076.201、展开球谐系数、维护 24 小时点序列；网页通过
`/api/realtime` 同源读取。SQLite 默认连续保存 7 天历元，观测台可以按
UTC 日期回放当日完整时间轴；Caster 本身不能倒播，因此后台程序需要全天
常驻运行。

Windows：

```powershell
python -m pip install -r scripts/requirements-realtime.txt
python scripts/realtime_gim_bridge.py --mode ntrip
```

Linux：

```bash
python3 -m pip install --user -r scripts/requirements-realtime.txt
python3 scripts/realtime_gim_bridge.py --mode ntrip
```

完整说明见：

`scripts/实时观测台部署说明.md`
