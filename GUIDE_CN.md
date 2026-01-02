# Scholar Reference Exporter - 安装与使用指南

## 📥 安装步骤（详细图文说明）

### 方法一：从ZIP文件安装（推荐）

#### 第一步：下载并解压
1. 下载 `scholar-reference-exporter.zip` 文件
2. 右键点击ZIP文件，选择"解压到当前文件夹"或"Extract Here"
3. 你会得到一个名为 `scholar-reference-exporter` 的文件夹

#### 第二步：打开Chrome扩展管理页面
1. 打开 Chrome 浏览器
2. 在地址栏输入：`chrome://extensions/`
3. 按 Enter 键进入扩展管理页面

#### 第三步：启用开发者模式
1. 在扩展管理页面的**右上角**，找到"开发者模式"（Developer mode）开关
2. 点击开关，使其变为**开启状态**（蓝色/ON）

#### 第四步：加载扩展
1. 点击页面左上角的 **"加载已解压的扩展程序"**（Load unpacked）按钮
2. 在弹出的文件选择窗口中，找到并选择 `scholar-reference-exporter` 文件夹
3. 点击"选择文件夹"（Select Folder）

#### 第五步：确认安装成功
1. 安装成功后，你会在扩展列表中看到 "Scholar Reference Exporter"
2. 在 Chrome 工具栏右侧会出现插件图标（蓝色文档图标）
3. 如果图标没有显示，点击工具栏的拼图图标 🧩，然后点击 Scholar Reference Exporter 旁边的📌图钉固定它

---

## 🎯 使用方法

### 基本使用流程

#### 第一步：访问 Google Scholar
1. 打开浏览器，访问 https://scholar.google.com
2. 在搜索框中输入你想搜索的关键词或论文标题
3. 按 Enter 搜索

#### 第二步：找到目标论文
1. 在搜索结果中找到你感兴趣的论文
2. 确保该论文有 "Cited by XXX" 链接（表示有引用）

#### 第三步：触发导出按钮
1. 将鼠标**悬停**在论文标题上（不需要点击）
2. 标题右侧会出现一个蓝色按钮：**"Export All References"**

#### 第四步：开始导出
1. 点击 "Export All References" 按钮
2. 会弹出进度窗口，显示：
   - 当前进度（百分比进度条）
   - 已收集的引用数量
   - 当前处理阶段

#### 第五步：等待完成
导出过程分为三个阶段：
1. **Stage 1/3**: 从 Google Scholar 收集所有引用论文（自动翻页）
2. **Stage 2/3**: 使用 Semantic Scholar API 补充元数据
3. **Stage 3/3**: 排序并生成 CSV 文件

#### 第六步：保存文件
1. 导出完成后，浏览器会自动弹出保存对话框
2. 选择保存位置，点击"保存"
3. CSV 文件会保存到你选择的位置

---

## ⚠️ 验证码处理

### 什么时候会遇到验证码？
当 Google Scholar 检测到短时间内有大量请求时，会要求进行人机验证。这是正常的保护机制。

### 如何处理验证码？

当插件检测到验证码时，会自动弹出提示窗口：

1. **点击"Open Verification Page"按钮**
   - 会在新标签页打开 Google Scholar 的验证页面

2. **在新标签页完成验证**
   - 通常是勾选 "I'm not a robot" 复选框
   - 或者完成图片选择验证

3. **返回原标签页**
   - 验证完成后，回到原来的标签页

4. **点击"I've Completed Verification"按钮**
   - 插件会自动检测验证是否成功
   - 成功后会自动继续导出过程

### 验证码处理技巧
- 如果第一次验证没成功，可以再次点击"Open Verification Page"重试
- 验证完成后建议等待2-3秒再点击确认按钮
- 如果反复出现验证码，建议等待5-10分钟后再尝试

---

## ⚙️ 设置说明

点击浏览器工具栏中的插件图标，可以打开设置面板：

### 可配置选项

| 选项 | 说明 | 默认值 | 建议值 |
|------|------|--------|--------|
| Max References | 最大导出引用数量 | 1000 | 100-500（避免触发验证码） |
| Semantic Scholar | 是否使用API补充元数据 | 开启 | 保持开启 |
| Auto Sort | 是否按年份排序（新→旧） | 开启 | 保持开启 |

### 设置建议
- **小规模导出**（<100 引用）：可以使用默认设置
- **大规模导出**（>500 引用）：建议分批导出，或准备好处理验证码

---

## 📊 导出文件说明

### CSV 文件格式

导出的 CSV 文件包含以下列：

| 列名 | 说明 | 示例 |
|------|------|------|
| Title | 论文标题 | "Deep Learning for..." |
| Authors | 作者列表（分号分隔） | "John Smith; Jane Doe" |
| Venue | 发表期刊/会议 | "Nature; ICML 2023" |
| Year | 发表年份 | 2023 |
| PDF URL | PDF 下载链接 | https://... |
| Abstract | 论文摘要 | "This paper presents..." |
| Scholar URL | Google Scholar 链接 | https://scholar.google.com/... |

### 打开 CSV 文件
- **Excel**: 直接双击打开，或"数据"→"从文本/CSV"
- **Google Sheets**: 上传文件或"文件"→"导入"
- **Numbers (Mac)**: 直接双击打开
- **Python/Pandas**: `pd.read_csv('filename.csv')`

---

## 🔧 常见问题解答

### Q: 按钮没有出现？
**A:** 
1. 确认插件已启用（检查 `chrome://extensions/`）
2. 刷新 Google Scholar 页面
3. 确保鼠标悬停在论文**标题链接**上

### Q: 导出很慢怎么办？
**A:** 
- 这是正常的，插件会在每次请求之间添加延迟以避免被封
- 每页约需要2-4秒，100篇引用约需要2-5分钟

### Q: 提示"Rate limited"怎么办？
**A:** 
1. 等待弹出的验证码处理窗口
2. 完成验证后继续
3. 如果持续出现，建议等待10-30分钟后再试

### Q: 某些论文没有摘要/PDF？
**A:** 
- 不是所有论文都有公开的摘要或PDF
- Semantic Scholar 数据库可能没有收录某些论文
- 这是正常情况，不影响其他数据

### Q: 支持哪些 Google Scholar 域名？
**A:** 
- scholar.google.com
- scholar.google.ca
- scholar.google.co.uk
- scholar.google.de
- scholar.google.fr
- scholar.google.co.jp
- scholar.google.com.hk
- scholar.google.com.tw
- scholar.google.com.au

---

## 🛡️ 隐私说明

- 所有数据处理都在你的浏览器本地完成
- 只有 Semantic Scholar API 调用会发送论文标题（用于获取元数据）
- 不收集任何用户个人信息
- 不需要登录任何账号

---

## 📝 更新日志

### v1.0.0
- 初始版本发布
- 支持自动分页抓取所有引用
- 集成 Semantic Scholar API 元数据补充
- 支持验证码检测和用户处理流程
- CSV 导出功能
- 进度追踪和取消功能
