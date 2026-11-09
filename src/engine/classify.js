/**
 * 用途层：这个东西是干什么用的。
 * 先查知识库（按包名/目录名关键词），查不到就按目录结构给「推测」，并标明是推测。
 */

const RULES = [
  // —— AI 出图 / 工作流 ——
  { re: /^comfyui/i, category: 'AI 图形界面', purpose: 'ComfyUI：节点式 Stable Diffusion 工作流，搭管线出图/出视频' },
  { re: /comfyui[-_]?manager/i, category: 'AI 图形界面', purpose: 'ComfyUI-Manager：ComfyUI 的扩展与模型管理器' },
  { re: /stable[-_]?diffusion[-_]?webui|sdwebui|a1111/i, category: 'AI 图形界面', purpose: 'Stable Diffusion WebUI：浏览器里的出图界面' },
  { re: /invokeai|fooocus|forge|kohya/i, category: 'AI 图形界面', purpose: 'Stable Diffusion 系出图 / 训练界面' },
  { re: /^(torch|pytorch|torchvision|torchaudio)$/i, category: 'AI 运行时', purpose: 'PyTorch：深度学习张量计算与 GPU 训练/推理运行时' },
  { re: /^(transformers|diffusers|accelerate|peft|bitsandbytes|safetensors|tokenizers|sentencepiece|einops|timm)$/i, category: 'AI 运行时', purpose: 'HuggingFace 系模型加载 / 微调 / 推理组件' },
  { re: /xformers|flash[-_]?attn|sageattention|triton|mamba[-_]ssm/i, category: 'AI 加速', purpose: '注意力/算子加速库，显著提升出图与训练速度' },
  { re: /onnxruntime|onnx|tensorrt|openvino/i, category: 'AI 运行时', purpose: '推理引擎：把模型跑在 CPU/GPU 上的执行后端' },
  { re: /^(ollama|lm[-_]?studio|llama[-_]?cpp|vllm|text-generation-webui)$/i, category: 'AI 运行时', purpose: '本地大语言模型运行器（下载模型后离线对话）' },
  { re: /whisper|faster[-_]?whisper|funasr|sensevoice/i, category: 'AI 语音', purpose: '语音识别模型/运行时（音频转文字）' },
  { re: /realesrgan|gfpgan|basicsr|insightface|facexlib|codeformer|spandrel/i, category: 'AI 图像', purpose: '图像修复 / 超分 / 换脸模型组件' },
  { re: /gradio|streamlit|fastapi|uvicorn|flask|aiohttp/i, category: 'Web 服务', purpose: 'Web 界面/服务框架，用来把模型能力开成网页接口' },

  // —— 3D / 建模 / 设计 ——
  { re: /blender/i, category: '3D 与设计', purpose: 'Blender：3D 建模、渲染、动画制作' },
  { re: /freecad|cadquery|openscad|fusion|solidworks|sketchup|rhino/i, category: '3D 与设计', purpose: 'CAD / 参数化建模工具' },
  { re: /unity|unreal|godot|twinmotion/i, category: '3D 与设计', purpose: '实时 3D / 游戏引擎' },
  { re: /meshlab|cloudcompare|meshmixer|instantmeshes/i, category: '3D 与设计', purpose: '网格处理 / 点云工具' },
  { re: /hunyuan3d|tripo|meshy|trellis/i, category: '3D 与设计', purpose: '文/图生 3D 模型生成工具' },
  { re: /^(numpy|scipy|pandas|polars|matplotlib|seaborn|plotly)$/i, category: '数据计算', purpose: '数值计算 / 数据处理 / 绘图库' },
  { re: /scikit[-_]?learn|sklearn|xgboost|lightgbm|catboost/i, category: '数据计算', purpose: '机器学习建模库' },
  { re: /opencv|pillow|scikit-image|imageio|moviepy/i, category: '图像处理', purpose: '图像/视频读写与处理库' },

  // —— 语言与包管理 ——
  { re: /^python(3)?$/i, category: '语言运行时', purpose: 'Python 解释器与标准库' },
  { re: /^(node|nodejs|node_modules)$/i, category: '语言运行时', purpose: 'Node.js 运行时 / 其依赖目录' },
  { re: /^(pip|setuptools|wheel|virtualenv|pipx|uv|poetry|conda|mamba)$/i, category: '包管理', purpose: 'Python 包安装与管理工具' },
  { re: /^(npm|pnpm|yarn|bun|npx)$/i, category: '包管理', purpose: 'Node 包管理器' },
  { re: /^(git|git[-_]lfs)$/i, category: '开发工具', purpose: 'Git 版本控制' },
  { re: /^(ffmpeg|ffprobe|imageio[-_]ffmpeg)$/i, category: '媒体工具', purpose: '音视频解码/编码/转码工具' },
  { re: /^(cuda|cudnn|nvidia|cuda[-_]toolkit|cu[0-9]+)$/i, category: '驱动与算力', purpose: 'NVIDIA GPU 计算驱动/工具链' },
  { re: /^(vscode|code|cursor|sublime|notepad\+\+)$/i, category: '开发工具', purpose: '代码编辑器' },
  { re: /^(chrome|edge|firefox|brave)$/i, category: '桌面应用', purpose: '浏览器' },
  { re: /^(7-?zip|winrar|bandizip)$/i, category: '桌面应用', purpose: '压缩/解压工具' },
  { re: /^(vlc|potplayer|obs|obs-studio)$/i, category: '媒体工具', purpose: '播放器 / 录屏推流' },
  { re: /^(wps|office|office16|libreoffice)$/i, category: '桌面应用', purpose: '办公套件' },
  { re: /^(steam|epic|wegame)$/i, category: '桌面应用', purpose: '游戏平台' },
  { re: /pyinstaller|nuitka/i, category: '开发工具', purpose: '把 Python 程序打包成独立可执行文件' },
  { re: /playwright|selenium|pyppeteer|puppeteer/i, category: '自动化', purpose: '浏览器自动化（无人值守点击/抓取）' },
  { re: /jupyter|ipython|notebook|nbconvert/i, category: '开发工具', purpose: '交互式 Python 笔记本' },
  { re: /^\.pnpm-store$/i, category: '包缓存', purpose: 'pnpm 的内容寻址仓库（硬链接源），删了已装依赖要重下' },
  { re: /^headlesschrome/i, category: '临时垃圾', purpose: '无头 Chrome 的临时 profile，进程退出后可删' },
  { re: /^pip-unpack-/i, category: '临时垃圾', purpose: 'pip 解包中转目录，安装结束后可删' },
  { re: /^thunderev/i, category: '临时垃圾', purpose: '下载器（迅雷）的临时缓存，可删' },
  { re: /安装包|setup.*\.exe$|\.msi$/i, category: '安装包', purpose: '下载到本地的安装程序，装完可删' },
  { re: /^pip[-_]?cache$/i, category: '缓存', purpose: '包下载缓存（可安全删除）' },
  { re: /^cdp-(eval|shot|seq|pose|smoke)/i, category: '临时垃圾', purpose: '浏览器自动化（CDP）的临时 profile 目录，可整目录删' },
  { re: /^(electron|wps|chrome|msedge)[-_]?crash|crashpad/i, category: '临时垃圾', purpose: '崩溃转储缓存，可删' },
  { re: /^-?edge[-_]?tts$|^node[-_]?edge[-_]?tts$/i, category: 'AI 语音', purpose: 'Edge TTS：用微软在线语音合成做配音' },
  { re: /tts|text[-_]?to[-_]?speech|cosyvoice|gpt[-_]?sovits/i, category: 'AI 语音', purpose: '语音合成（文字转语音）工具链' },
  { re: /3d[-_]?printer|printer/i, category: '3D 与设计', purpose: '3D 打印相关项目/模型' },
  { re: /prompt[-_]?optimi[sz]er/i, category: 'AI 工具', purpose: '提示词优化器：把草稿改写成更好的提示词' },
  { re: /livedeck|场控|live[-_]?deck/i, category: '直播工具', purpose: '直播场控台（弹窗、话术、礼物联动）' },
  { re: /clipcat/i, category: 'AI 工具', purpose: '短视频带货技能包（爆款拆解与复刻）' },
  { re: /^electron$/i, category: '桌面开发', purpose: 'Electron：用网页技术打包桌面应用' },
  { re: /builder|webpack|vite|rollup|esbuild|tsup|tsdown/i, category: '桌面开发', purpose: '前端/打包构建工具链' },
  { re: /inno\s?setup|nsis|advanced\s?installer/i, category: '开发工具', purpose: 'Windows 安装包制作工具（把程序打成 setup.exe）' },
]

const PATH_RULES = [
  { re: /[\\/]Temp[\\/]cdp-/i, category: '临时垃圾', purpose: '浏览器自动化（CDP）跑一次留下的临时 profile，可整目录删' },
  { re: /[\\/]Temp[\\/]/i, category: '临时文件', purpose: '程序运行期的临时产物，重启或清理后可删' },
  { re: /[\\/]Installer[\\/]/i, category: '安装缓存', purpose: 'Windows Installer 的补丁/MSI 缓存，删了会影响卸载与修复' },
  { re: /[\\/]site-packages[\\/]/i, category: 'Python 依赖', purpose: 'Python 第三方包安装目录' },
  { re: /[\\/]dist-packages[\\/]/i, category: 'Python 依赖', purpose: '系统级 Python 包目录' },
  { re: /[\\/]node_modules[\\/]/i, category: 'Node 依赖', purpose: 'Node 项目依赖目录' },
  { re: /[\\/]envs[\\/]/i, category: '运行环境', purpose: 'conda 独立环境' },
  { re: /[\\/]\.venv|[\\/]venv[\\/]/i, category: '运行环境', purpose: 'Python 虚拟环境' },
  { re: /[\\/]WinGet[\\/]Packages/i, category: '安装目录', purpose: 'winget 安装的便携程序' },
  { re: /[\\/]chocolatey[\\/]lib/i, category: '安装目录', purpose: 'Chocolatey 安装的包' },
]

const leafOf = (path) => {
  const parts = String(path || '').split(/[\\/]/).filter(Boolean)
  return parts[parts.length - 1] || ''
}

/**
 * @param {string} name 包名或目录名
 * @param {string} path 磁盘路径（可空）
 * @returns {{category:string, purpose:string, known:boolean}}
 */
export function classify(name, path = '') {
  const subject = String(name || '') || leafOf(path)
  for (const rule of RULES) {
    if (rule.re.test(subject)) return { category: rule.category, purpose: rule.purpose, known: true }
  }
  if (path) {
    for (const rule of PATH_RULES) {
      if (rule.re.test(path)) {
        return { category: rule.category, purpose: `${rule.purpose}（${subject || '未知包'}）`, known: true }
      }
    }
    if (/[\\/]\.git([\\/]|$)/.test(path)) {
      return { category: '代码仓库', purpose: `${subject}：从 Git 仓库克隆的项目源码（体积主要来自依赖与模型权重）`, known: false }
    }
    if (/[\\/]Program Files[\\/]/i.test(path)) {
      return { category: '已安装程序', purpose: `常规 Windows 安装程序：${subject}（用途需按目录内文件判断）`, known: false }
    }
    if (/[\\/]\.cache[\\/]/i.test(path)) {
      return { category: '缓存', purpose: `${subject} 的缓存数据，可重建`, known: false }
    }
  }
  return { category: '未归类', purpose: `${subject || '该项'}：知识库未收录，按名称与目录结构推测（可在 src/engine/classify.js 里补一条规则）`, known: false }
}

/** 人类可读体积 */
export function formatBytes(bytes) {
  const n = Number(bytes) || 0
  if (n < 1024) return `${n} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let value = n / 1024
  let index = 0
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024
    index++
  }
  return `${value.toFixed(value >= 100 ? 0 : 1)} ${units[index]}`
}
