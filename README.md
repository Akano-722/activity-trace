# phone-activity-tracker

iPhone 快捷指令上报 App 打开/关闭，服务器记录使用时间。

## Zeabur 环境变量

- `PORT`：3000
- `API_KEY`：自己设一串密码，比如 `my-secret-key`
- `DATA_DIR`：默认 `data`，如需持久保存，请在 Zeabur 绑定 Volume 到 `/app/data`

## iPhone 快捷指令 URL

```txt
https://你的域名/api/screentime/toggle/小红书?key=你的API_KEY
```

方法选 GET。

## 查询

```txt
https://你的域名/api/screentime/today?key=你的API_KEY
https://你的域名/api/screentime/logs?key=你的API_KEY
```
