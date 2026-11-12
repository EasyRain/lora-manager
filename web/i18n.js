/* 语言包：键就是中文原文，英文查表；查不到就原样显示，不会出现空白。
   加语言只要再补一张表。 */
'use strict';

const I18N = {
  en: {
    // ---- 顶栏 ----
    'LoRA 管理器': 'LoRA Manager',
    '搜索标题 / 正文…': 'Search title / content…',
    '在资源管理器里打开': 'Open data folder',
    '数据': 'Data',
    '根目录': 'Root folder',
    '设置 LoRA 根目录': 'Set LoRA root folder',
    '撤销移动': 'Undo move',
    '就绪': 'Ready',
    '未保存…': 'Unsaved…',
    '已保存 ': 'Saved ',
    '保存失败': 'Save failed',
    '保存失败：': 'Save failed: ',
    '切换语言': 'Switch language',

    // ---- 主题 ----
    '🌗 跟随': '🌗 Auto',
    '☀ 亮色': '☀ Light',
    '🌙 暗色': '🌙 Dark',
    '跟随系统': 'Follow system',
    '跟随系统（当前': 'Follow system (now ',
    '亮色': 'light',
    '暗色': 'dark',
    '主题：': 'Theme: ',

    // ---- 侧栏 ----
    '🗂 根目录': '🗂 Root',
    '其它': 'Other',
    '🙈 隐藏': '🙈 Hidden',
    '（没有子文件夹）': '(no subfolders)',

    // ---- 卡片 ----
    '空': 'Empty',
    '隐藏': 'Hidden',
    '正文': 'Content',
    '(无标题)': '(untitled)',
    '（没有绑定 LoRA 文件）': '(no LoRA file bound)',
    '新建小卡片': 'New entry',
    '编辑大卡片 / 移动': 'Edit card / move',
    '复制这条': 'Copy this',
    '编辑': 'Edit',
    '取消隐藏': 'Unhide',
    '还没有内容，点标题右边的 ＋ 新建小卡片。': 'No entries yet — click ＋ above to add one.',
    '已隐藏，右键或点 ↩ 恢复。': 'Hidden — right-click or click ↩ to restore.',
    '还没有小卡片，点 ＋ 新建（右键也有）': 'No entries yet — click ＋ (or right-click) to add one',
    '权重': 'weight',
    '这张卡还没有提示词。': 'This card has no entries yet.',

    // ---- 右键菜单 ----
    '预览': 'Preview',
    '新建小卡片': 'New entry',
    '复制这一条': 'Copy this entry',
    '删除这一条': 'Delete this entry',
    '编辑大卡片': 'Edit card',
    '复制全部提示词': 'Copy all entries',
    '移动到…': 'Move to…',
    '重命名 LoRA 文件…': 'Rename LoRA file…',
    '隐藏这个 LoRA': 'Hide this LoRA',
    '在资源管理器中显示': 'Show in Explorer',
    '删除大卡片': 'Delete card',
    '打开': 'Open',
    '重命名文件夹…': 'Rename folder…',
    '新建子文件夹…': 'New subfolder…',
    '删除文件夹': 'Delete folder',
    '新建大卡片': 'New card',
    '新建文件夹…': 'New folder…',
    '按规则排序（有提示词的在前）': 'Auto-sort (with entries first)',
    '刷新这个目录': 'Refresh',
    '在资源管理器中打开': 'Open in Explorer',

    // ---- 提示 / 确认 ----
    '已复制 ': 'Copied ',
    ' 字符': ' chars',
    '已改名': 'Renamed',
    '改名失败：': 'Rename failed: ',
    '已隐藏（左侧「隐藏」里能找到）': 'Hidden (find it under “Hidden”)',
    '已取消隐藏': 'Unhidden',
    '已创建 ': 'Created ',
    '文件夹里还有东西，先清空再删': 'Folder is not empty',
    '已删除': 'Deleted',
    '只接受 .safetensors / .ckpt 这类 LoRA 文件': 'Only LoRA files (.safetensors / .ckpt) are accepted',
    '正在复制 ': 'Copying ',
    '已复制 ': 'Copied ',
    '已刷新': 'Refreshed',
    '已撤销': 'Undone',
    '撤销失败：': 'Undo failed: ',
    '根目录已切换': 'Root folder changed',
    '选中的没有正文': 'Nothing to copy',
    '图片上传失败': 'Image upload failed',
    '图片已加入（保存后生效）': 'Image added (applies after save)',
    '新大卡片': 'New card',
    '新卡片': 'New card',
    '已按规则排序：有提示词 ': 'Sorted: ',
    ' 张在前，空 ': ' with entries first, ',
    ' 张在后': ' empty last',
    '微调': 'minor',
    '已经是规整的了': 'Already tidy',
    '选中的这段已经规整了': 'Selection is already tidy',
    '撤销': 'Undo',
    '格式化': 'Format',
    '全角标点 ': 'full-width punct ',
    '换行 ': 'newlines ',
    '多余空格 ': 'extra spaces ',
    '逗号 ': 'commas ',
    '已格式化选中 ': 'Formatted selection: ',
    ' 字符：': ' chars: ',
    '已格式化：': 'Formatted: ',

    // ---- 输入框 / 弹窗 ----
    '大卡片标题（留空就用文件名）': 'Card title (blank = file name)',
    '标题（可留空），例如：提示词 / 备忘': 'Title (optional), e.g. prompt / note',
    '写点什么…（回车保存，Shift+回车换行，可直接粘贴截图）':
      'Type anything… (Enter to save, Shift+Enter for newline)',
    '选图': 'Image',
    '复制正文': 'Copy text',
    '删除': 'Delete',
    '保存': 'Save',
    '关闭 (Esc)': 'Close (Esc)',
    '移除图片': 'Remove image',
    '所在文件夹': 'Folder',
    '推荐强度': 'Strength',
    '如 0.7-1.0（留空不显示）': 'e.g. 0.7-1.0 (blank = hidden)',
    '换文件夹会把 LoRA 文件真的挪过去（旧工作流里存的路径会失效，挪完要重启 ComfyUI）。':
      'Changing folder physically moves the LoRA file — old workflows will lose the path; restart ComfyUI afterwards.',
    '这张卡没绑定 LoRA 文件，换文件夹只是换个位置放卡片。':
      'This card has no LoRA file; changing folder only moves the card.',
    '保存后会为这个 LoRA 建一张卡；直接关掉什么都不会发生。':
      'A card will be created for this LoRA on save; closing does nothing.',
    '保存后会为这个 LoRA 建一张卡。': 'A card will be created for this LoRA on save.',
    '把选中的 ': 'Move ',
    '项移到': ' selected to',
    '目标文件夹': 'Target folder',
    '移动': 'Move',
    'LoRA 文件会真的被挪动；只挪卡片不影响文件时，文件保持原位。':
      'LoRA files are moved on disk; pure cards just change location.',
    '回车保存 · Shift+回车换行 · Esc 关闭': 'Enter to save · Shift+Enter newline · Esc to close',
    '双击卡片标题看整张，双击某一条只看那条':
      'Double-click a card title for all entries, an entry for just that one',
    '复制原文': 'Copy raw',
    '把全角逗号、多余空格、重复逗号之类规整掉': 'Normalize punctuation, spaces and commas',

    // ---- 空状态 / 面包屑 ----
    '这个文件夹还是空的。在空白处右键新建，或把 .safetensors 拖进来。':
      'This folder is empty. Right-click to create a card, or drop a .safetensors here.',
    '还没有设置 LoRA 目录 —— 点顶栏「⚙ 根目录」选一个 ComfyUI 的 models\\loras。':
      'No LoRA folder set — click “Root folder” in the toolbar.',
    '还没有设置 LoRA 根目录，点顶栏「⚙ 根目录」选一个':
      'No LoRA root folder set — click “Root folder” in the toolbar',
    '全部': 'All',
    '及下级': ' + subfolders',
    '搜索结果': 'Search results',
    '搜索': 'Search',
    '个 LoRA · ': ' LoRAs · ',
    ' 张卡': ' cards',
    '个': '',

    // ---- 拖放 ----
    '松开就复制到': 'Drop to copy into',

    '已把 ': 'Bound ',
    ' 张卡片绑到磁盘文件': ' cards to LoRA files',
    '已按规则排序：有提示词 ': 'Sorted: ',
    ' 张在前，空 ': ' with entries first, ',
    ' 张在后': ' empty last',
    '已选': 'Selected',
    '分隔': 'Separator',
    '去重': 'Dedupe',
    '合并复制': 'Copy merged',
    '清除': 'Clear',
    '目标文件夹': 'Target folder',
    '移动': 'Move',
    '新建大卡片': 'New card',

    '读取 library 失败 ': 'Failed to read library: ',
    '目录扫描失败 ': 'Folder scan failed: ',
    '重命名文件夹：': 'Rename folder:',
    '重命名 LoRA 文件（不含扩展名）：': 'Rename LoRA file (without extension):',
    '(无标题)': '(untitled)',

    '删除 LoRA 文件…': 'Delete LoRA file…',
    '导入 LoRA 文件…': 'Import LoRA file…',
    '导入 LoRA 到这里…': 'Import LoRA here…',
    '删除 LoRA 文件「': 'Delete LoRA file “',
    '」？会进回收站（可恢复）；这张卡片会变成不绑定文件的文本卡，提示词保留。':
      '”? It goes to the Recycle Bin (recoverable). The card becomes a text-only card and keeps its entries.',
    '已删除 ': 'Deleted ',
    '删除失败：': 'Delete failed: ',

    '这张卡片不放图片，图片请加在小卡片上': 'Images belong to entries, not to the card itself',
    '编辑界面里只能拖图片进来；导入 LoRA 请在卡片区拖放':
      'Only images can be dropped here; drop LoRA files on the card area',

    '在 Civitai 打开': 'Open on Civitai',
    '正在查 Civitai…': 'Looking up Civitai…',
    'Civitai 上没找到这个模型（可能已下架，或不是从 Civitai 下的）':
      'Not found on Civitai (removed, or not downloaded from there)',
    '已打开模型页': 'Opened model page',
    '查询失败：': 'Lookup failed: ',

    '匹配 Civitai': 'Match Civitai',
    '给还没匹配过的 LoRA 查 Civitai 页面': 'Look up Civitai pages for unmatched LoRAs',
    '没有需要匹配的 LoRA 了': 'Nothing left to match',
    '检测连通…': 'Checking…',
    '计算哈希…': 'Hashing…',
    '匹配中 ': 'Matching ',
    '匹配完成：': 'Done: ',
    ' 个有页面，': ' with pages, ',
    ' 个没有': ' without',
    '（已中断）': ' (cancelled)',
    '匹配失败：': 'Match failed: ',
    '连不上 Civitai（3 秒超时），已停止': 'Cannot reach Civitai (3s timeout), stopped',
    '刷新 Civitai 信息': 'Refresh Civitai info',



    '已匹配：点开 Civitai 页面': 'Matched — click to open the Civitai page',
    '未匹配：点一下查这个 LoRA': 'Not matched — click to look it up',
    '还剩 ': ' ',
    ' 个未匹配': ' to process',
    '全部匹配过了': 'Everything is matched',

    '已匹配': 'Matched',
    '无匹配：Civitai 上没有这个模型': 'No match: not on Civitai',

    // ---- 主题提示 ----
    '主题：跟随系统': 'Theme: follow system',
    '主题：亮色': 'Theme: light',
    '主题：暗色': 'Theme: dark',
  },
};

let LANG = localStorage.getItem('lora.lang') || 'zh';

function t(s, vars) {
  let out = s;
  if (LANG === 'en') {
    const hit = I18N.en[s];
    out = hit == null ? s : hit;
  }
  if (vars) {
    Object.keys(vars).forEach((k) => {
      out = out.split('{' + k + '}').join(vars[k]);
    });
  }
  return out;
}

/* 静态 HTML 用 data-i18n / data-i18n-ph / data-i18n-title 标记 */
function applyStaticI18n() {
  document.querySelectorAll('[data-i18n]').forEach((el) => {
    el.textContent = t(el.dataset.i18n);
  });
  document.querySelectorAll('[data-i18n-ph]').forEach((el) => {
    el.placeholder = t(el.dataset.i18nPh);
  });
  document.querySelectorAll('[data-i18n-title]').forEach((el) => {
    el.title = t(el.dataset.i18nTitle);
  });
}

function setLang(lang) {
  LANG = lang === 'en' ? 'en' : 'zh';
  localStorage.setItem('lora.lang', LANG);
  document.documentElement.lang = LANG === 'en' ? 'en' : 'zh-CN';
  document.title = t('LoRA 管理器');   // WebView2 会把它冒到窗口标题上
  applyStaticI18n();
}
