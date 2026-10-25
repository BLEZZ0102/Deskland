# 第三方依赖 / Third-party dependencies

## Microsoft Edge WebView2

Windows 宿主使用 Microsoft Edge WebView2 SDK 与 WebView2 Runtime。构建脚本从 NuGet 获取开发库，本仓库不提交 SDK 二进制文件。

- 包：`Microsoft.Web.WebView2`，构建版本 `1.0.4191.47`。
- 包与许可信息：https://www.nuget.org/packages/Microsoft.Web.WebView2/1.0.4191.47
- 文档：https://learn.microsoft.com/microsoft-edge/webview2/

WebView2 及 Windows / .NET Framework 组件适用各自的许可条款，不因本项目的 GPL-3.0 许可而变更。

The host uses the Microsoft Edge WebView2 SDK and Runtime. SDK binaries are downloaded by the build script and are not checked into this repository. Microsoft components retain their respective licenses.
