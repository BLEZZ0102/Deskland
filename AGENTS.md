# Deskland 开源体验版开发指南

- 用中文与项目负责人沟通。
- 本仓库包含基础宿主、共用界面与框架、沙滩和草地两个免费主题。
- 保持 `themes.json`、主题参数默认值和中英文文案一致。
- 修改主题后检查图标移动、预览、暂停和分享；所有画布按实际像素与小数显示尺寸绘制。
- 壁纸常驻后台，以核显 30fps 为目标。静态绘图进入缓存，小物体使用局部图层，不在全屏着色器中逐个计算大量物体。
- `prototype/thumbs/` 是人工设计的缩略图，未经要求不要重新生成或覆盖。
- 主程序：`powershell -ExecutionPolicy Bypass -File host\build.ps1`；产物 `host/bin/Deskland.exe`。
- 浏览器预览：`node prototype\serve.mjs`，访问 `http://localhost:5178/settings.html`。
- Windows 宿主：`host/DesktopHost.cs`；改主题 HTML/JS 不需要重新编译宿主，托盘“重新载入”即可。
- 程序读写 `%LOCALAPPDATA%\Deskland`，调试时不要覆盖用户的真实设置。
- 不提交 `host/bin/`、`host/lib/`、个人数据、凭证或本机路径。
- 发布或修改商标相关内容前须获得项目负责人的明确指示。
- 许可见 `LICENSE`，名称和图标的说明见 `TRADEMARKS.md`。
