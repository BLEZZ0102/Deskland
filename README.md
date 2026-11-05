# Deskland Preview

让桌面图标成为风景的一部分。 / Let your desktop icons become part of the scenery.

Deskland Preview 是一款 Windows 自适应动态壁纸体验版。移动桌面图标时，海岸线、草地与云会实时调整，让图标融入画面。

本仓库是免费的开源体验版，包含 **沙滩** 和 **草地** 两个可用主题，没有使用时限。无需账号或 API Key。其他主题的缩略图用于展示壁纸版内容，不包含这些主题的页面源码。Preview 与开发版使用不同的安装目录、用户数据、启动项和运行实例标识，可以同时保留。

## 功能

- 根据真实桌面图标的位置生成场景，并在图标移动、添加或删除时平滑调整。
- 沙滩上的海浪、皮划艇、海鸟和椰子树。
- 草地上的云影、放风筝的男孩和小黑猫。
- 其他主题显示带锁缩略图，点击可查看壁纸版说明并前往官网。
- 中英文设置界面，主题参数自动保存。
- 托盘控制、开机自动启动、前台窗口最大化或全屏时暂停。
- 分享图片和动画时使用示例图标与名字色块，不截取桌面窗口或真实文件名。

## 系统要求

- Windows 10 / Windows 11，64 位；目前只覆盖主显示器。
- Microsoft Edge WebView2 Runtime。
- 构建使用 Windows 自带的 .NET Framework C# 编译器，无需安装 .NET SDK。
- 第一次构建需要联网下载 WebView2 开发库。

## 从源码运行

在仓库根目录打开 PowerShell：

```powershell
powershell -ExecutionPolicy Bypass -File host\build.ps1
host\bin\Deskland.exe
```

编译结果位于 `host/bin/`。运行时请保持 `host/` 和 `prototype/` 的相对目录结构。

双击托盘图标或再次运行程序可打开设置；退出请使用托盘菜单中的“退出（恢复原壁纸）”，或执行：

```powershell
host\bin\Deskland.exe --exit
```

程序设置与日志位于 `%LOCALAPPDATA%\DesklandPreview`。沙滩和草地的设置可持续保留；同一时间只运行一个 Deskland Preview 实例，开发版的设置和实例不受影响。

## Windows 安装包

体验版安装包名为 `Deskland-Preview-0.1.2-win-x64-Setup.exe`，安装到当前用户的 `Programs\Deskland Preview` 目录，无需管理员权限。开始菜单的 `Deskland Preview` 文件夹中可启动和卸载，卸载保留用户设置。安装包自带对应源码 `Deskland-source.zip`。

已安装 WebView2 Runtime 时可离线安装；缺少时会调用微软引导程序联网安装。当前安装包未签名。

制作安装包：`powershell -ExecutionPolicy Bypass -File tools\build-installer.ps1`。首次下载便携版 NSIS 与微软 WebView2 引导程序，不安装全局开发工具；产物位于 `dist/`，附 SHA256 校验文件。

## 浏览器预览

安装 Node.js 后，在仓库根目录执行：

```powershell
node prototype\serve.mjs
```

打开 `http://localhost:5178/settings.html`。浏览器使用示例图标，真实桌面图标适配需要 Windows 宿主。

## 目录

| 路径 | 用途 |
| --- | --- |
| `host/` | Windows 宿主、构建脚本与清单 |
| `prototype/flat.html` | 沙滩主题 |
| `prototype/meadow.html` | 草地主题 |
| `prototype/settings.html` | 设置界面 |
| `prototype/themes.json` | 两个免费主题的完整参数，以及其他主题的锁定展示信息与缩略图 |
| `prototype/share.js` | 分享图片和动画 |
| `prototype/assets/` | 主题所需的图片素材 |

## 已知限制

- 目前只支持主显示器。
- Windows 使用壁纸幻灯片或 Windows 聚焦时，系统换图可能造成短暂闪烁。
- 安装包暂为本地测试版本，尚未对外发布。

## 许可与反馈

本仓库的项目源码和随附主题素材按 [GPL-3.0](LICENSE) 发布；第三方依赖见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。Deskland 的名称与图标不作为商标授权授予，见 [TRADEMARKS.md](TRADEMARKS.md)。

问题反馈请使用本仓库的 Issues。个人项目，不保证即时回复。

## English

Deskland is an adaptive Windows wallpaper that responds to the positions of your desktop icons. This free, open-source preview includes **Beach** and **Meadow**, with no time limit, account or API key required.

Build on 64-bit Windows with `powershell -ExecutionPolicy Bypass -File host\build.ps1`, then run `host\bin\Deskland.exe`. The first build downloads the WebView2 SDK from NuGet; the WebView2 Runtime is required to run the application. Keep the `host/` and `prototype/` directories together.

For a browser preview with sample icons, run `node prototype\serve.mjs` and open `http://localhost:5178/settings.html`. Only the Windows host adapts to real desktop icons. Currently, only the primary monitor is supported. Source and included theme assets are licensed under GPL-3.0; the Deskland name and icon remain subject to the trademark notice above.
