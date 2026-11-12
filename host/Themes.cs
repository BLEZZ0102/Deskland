using System;
using System.Collections.Generic;
using System.IO;
using System.Text;

// 主题清单（prototype/themes.json）：页面映射与产品权限共用同一份清单。
// 未标 product 的 ready 主题默认拒绝，避免新增付费主题被意外免费开放。
static class Themes
{
    static Dictionary<string, object> Find(string pageDir, string id)
    {
        if (id == null) return null;
        try
        {
            var root = Json.Parse(File.ReadAllText(Path.Combine(pageDir, "themes.json"), Encoding.UTF8)) as Dictionary<string, object>;
            if (root == null) return null;
            foreach (object o in (System.Collections.IEnumerable)root["themes"])
            {
                var theme = o as Dictionary<string, object>;
                if (theme != null && (theme["id"] as string) == id &&
                    theme.ContainsKey("status") && (theme["status"] as string) == "ready")
                    return theme;
            }
        }
        catch (Exception ex) { Log.Write("读取 themes.json 失败：" + ex.Message); }
        return null;
    }

    // 所有 ready 主题的 id（按清单顺序）
    public static List<string> ReadyIds(string pageDir)
    {
        var ids = new List<string>();
        try
        {
            var root = Json.Parse(File.ReadAllText(Path.Combine(pageDir, "themes.json"), Encoding.UTF8)) as Dictionary<string, object>;
            if (root != null)
                foreach (object o in (System.Collections.IEnumerable)root["themes"])
                {
                    var theme = o as Dictionary<string, object>;
                    if (theme != null && theme.ContainsKey("status") && (theme["status"] as string) == "ready" && theme["id"] is string)
                        ids.Add((string)theme["id"]);
                }
        }
        catch (Exception ex) { Log.Write("读取 themes.json 失败：" + ex.Message); }
        return ids;
    }

    public static string PageFor(string pageDir, string id)
    {
        var theme = Find(pageDir, id);
        return theme == null ? null : theme["page"] as string;
    }

    public static string ProductFor(string pageDir, string id)
    {
        var theme = Find(pageDir, id);
        object product;
        return theme != null && theme.TryGetValue("product", out product) ? product as string : null;
    }

    public static bool Allowed(string pageDir, string id, Func<string, bool> owns)
    {
        if (PageFor(pageDir, id) == null) return false;
        string product = ProductFor(pageDir, id);
        if (product == "free") return true;
        return product != null && owns != null && owns(product);
    }
}
