export function panelTemplate() {
    return `
<aside id="is-panel" class="is-panel" aria-hidden="true">
  <header class="is-header">
    <div class="is-title">
      <i class="fa-solid fa-palette"></i>
      <span>画坊</span>
      <small>Image Studio</small>
    </div>
    <div class="is-header-actions">
      <button type="button" id="is-header-status" class="is-status-chip" title="ComfyUI 连接状态">
        <span id="is-header-dot" class="is-dot"></span>
        <span id="is-header-status-text">ComfyUI 未连接</span>
      </button>
      <button type="button" id="is-close" class="is-icon-button" title="关闭"><i class="fa-solid fa-xmark"></i></button>
    </div>
  </header>

  <nav class="is-tabs" role="tablist">
    <button type="button" class="is-tab active" data-is-tab="generate"><i class="fa-solid fa-wand-magic-sparkles"></i><span>生成</span></button>
    <button type="button" class="is-tab" data-is-tab="monitor"><i class="fa-solid fa-desktop"></i><span>PC / 队列</span></button>
    <button type="button" class="is-tab" data-is-tab="library"><i class="fa-solid fa-address-book"></i><span>角色库</span></button>
    <button type="button" class="is-tab" data-is-tab="api"><i class="fa-solid fa-key"></i><span>API</span></button>
    <button type="button" class="is-tab" data-is-tab="history"><i class="fa-solid fa-clock-rotate-left"></i><span>记录</span></button>
  </nav>

  <div class="is-body">
    <section class="is-pane" data-is-pane="generate">
      <div class="is-provider-row">
        <div class="is-seg" id="is-provider-seg">
          <button type="button" data-is-provider="comfy" class="active"><i class="fa-solid fa-desktop"></i> 本地 ComfyUI</button>
          <button type="button" data-is-provider="cloud"><i class="fa-solid fa-cloud"></i> 云端 API</button>
        </div>
      </div>

      <div id="is-comfy-brief" class="is-brief">
        <span id="is-brief-dot" class="is-dot"></span>
        <span id="is-brief-text" class="is-grow">ComfyUI 未配置</span>
        <button type="button" class="is-link" id="is-quick-test">一键连接</button>
      </div>

      <div id="is-cloud-bar" class="is-field" hidden>
        <label for="is-cloud-profile">生图 API</label>
        <select id="is-cloud-profile" class="text_pole"></select>
        <div id="is-cloud-hint" class="is-hint"></div>
      </div>

      <div id="is-generation-source" class="is-brief is-generation-source">
        <i class="fa-solid fa-tag"></i>
        <span id="is-generation-source-label" class="is-grow">手动提示词</span>
        <button type="button" class="is-link" id="is-generation-source-reset" hidden>切回手动</button>
      </div>

      <div class="is-field">
        <div class="is-field-head">
          <label for="is-positive">正面提示词</label>
          <div class="is-inline-actions">
            <button type="button" class="is-link" id="is-fill-char" title="把角色卡外观填入提示词">角色外观</button>
            <button type="button" class="is-link" id="is-rewrite-toggle">AI 改写</button>
          </div>
        </div>
        <textarea id="is-positive" class="text_pole is-textarea" rows="4" placeholder="masterpiece, best quality, {{charDescription}}&#10;{{scene}}"></textarea>
        <div class="is-macro-hint">可用：{{charDescription}} · {{scene}} · {{lastMessage}} · {{persona}} · {{charName}}</div>
      </div>

      <div id="is-rewrite-box" class="is-subbox" hidden>
        <div class="is-subbox-title">让插件内部模型写成生图提示词 <span class="is-hint">独立链路，不会切换聊天 API</span></div>
        <input id="is-rewrite-intent" class="text_pole" type="text" placeholder="画面意图（可留空，例如：雨后屋檐下回头）" />
        <div class="is-route-line">
          <i class="fa-solid fa-microchip"></i>
          <span class="is-grow">插件内部模型：<b id="is-rewrite-route">跟随酒馆当前聊天 API</b></span>
          <button type="button" class="is-link" id="is-rewrite-route-settings">设置</button>
        </div>
        <div class="is-field">
          <label>风格
            <select id="is-rewrite-style" class="text_pole">
              <option value="tags">标签风（SD / Danbooru）</option>
              <option value="natural">自然语言（Gemini / GPT Image）</option>
            </select>
          </label>
        </div>
        <div class="is-field">
          <div class="is-field-head">
            <label>系统提示词</label>
            <button type="button" class="is-link" id="is-rewrite-system-reset">恢复内置</button>
          </div>
          <select id="is-rewrite-system-source" class="text_pole">
            <option value="st">酒馆当前预设（需跟随当前聊天 API）</option>
            <option value="builtin">画坊内置</option>
            <option value="custom">自定义</option>
          </select>
          <div id="is-rewrite-system-text-wrap" hidden>
            <textarea id="is-rewrite-system-text" class="text_pole is-textarea is-mono" rows="4"></textarea>
          </div>
          <div id="is-rewrite-system-hint" class="is-hint"></div>
        </div>
        <div class="is-inline-actions is-right">
          <button type="button" class="menu_button" id="is-rewrite-run">改写</button>
        </div>
        <div id="is-rewrite-status" class="is-hint"></div>
      </div>

      <div id="is-reference-bar" class="is-brief is-reference-bar" hidden>
        <img id="is-reference-thumb" alt="参考图" />
        <span id="is-reference-label" class="is-grow">参考图</span>
        <button type="button" class="is-link" id="is-reference-clear">清除</button>
      </div>

      <details class="is-negative-wrap">
        <summary>负面提示词</summary>
        <textarea id="is-negative" class="text_pole is-textarea" rows="2" placeholder="lowres, bad anatomy..."></textarea>
      </details>

      <div class="is-grid is-grid-3">
        <label>尺寸
          <select id="is-size-preset" class="text_pole"></select>
        </label>
        <label>数量
          <input id="is-count" class="text_pole" type="number" min="1" max="8" step="1" />
        </label>
        <label>Seed
          <input id="is-seed" class="text_pole" type="number" step="1" placeholder="-1 随机" />
        </label>
      </div>
      <div class="is-grid is-grid-2" id="is-size-custom">
        <label>宽
          <input id="is-width" class="text_pole" type="number" min="64" max="4096" step="8" />
        </label>
        <label>高
          <input id="is-height" class="text_pole" type="number" min="64" max="4096" step="8" />
        </label>
      </div>

      <div class="is-field" id="is-comfy-model-wrap">
        <div class="is-field-head">
          <label for="is-checkpoint">Checkpoint</label>
          <button type="button" class="is-link" id="is-refresh-models">刷新模型</button>
        </div>
        <select id="is-checkpoint" class="text_pole"></select>
      </div>

      <div class="is-field" id="is-cloud-model-wrap" hidden>
        <label for="is-cloud-model">模型名</label>
        <input id="is-cloud-model" class="text_pole" type="text" list="is-cloud-model-list" placeholder="gpt-image-1 / gemini-2.5-flash-image" />
        <datalist id="is-cloud-model-list"></datalist>
        <div id="is-cloud-model-hint" class="is-hint"></div>
      </div>

      <details class="is-advanced" id="is-advanced">
        <summary><i class="fa-solid fa-sliders"></i> 高级参数</summary>

        <div id="is-comfy-advanced">
          <div class="is-grid is-grid-2">
            <label>采样器
              <select id="is-sampler" class="text_pole"></select>
            </label>
            <label>调度器
              <select id="is-scheduler" class="text_pole"></select>
            </label>
            <label>步数
              <input id="is-steps" class="text_pole" type="number" min="1" max="200" />
            </label>
            <label>CFG
              <input id="is-cfg" class="text_pole" type="number" min="0" max="30" step="0.1" />
            </label>
          </div>
          <div class="is-field">
            <label>VAE（留空用模型自带）</label>
            <select id="is-vae" class="text_pole"></select>
          </div>

          <div class="is-subbox">
            <div class="is-subbox-title">LoRA <button type="button" class="is-link" id="is-add-lora">+ 添加</button></div>
            <div id="is-loras" class="is-lora-list"></div>
          </div>

          <div class="is-subbox">
            <label class="checkbox_label"><input type="checkbox" id="is-hires-enabled" /> 高清修复（潜空间放大再采样）</label>
            <div class="is-grid is-grid-3" id="is-hires-fields">
              <label>倍率 <input id="is-hires-scale" class="text_pole" type="number" min="1" max="3" step="0.05" /></label>
              <label>步数 <input id="is-hires-steps" class="text_pole" type="number" min="1" max="100" /></label>
              <label>降噪 <input id="is-hires-denoise" class="text_pole" type="number" min="0" max="1" step="0.05" /></label>
            </div>
          </div>

          <div class="is-field">
            <label>图生图降噪 <span class="is-hint">0.35 更贴近参考图 · 0.55 平衡 · 0.75 更自由</span></label>
            <input id="is-img2img-denoise" class="text_pole" type="number" min="0.05" max="1" step="0.05" />
          </div>
          <div class="is-field">
            <label>参考图（图生图 / 角色一致性）</label>
            <input id="is-reference-file" type="file" accept="image/*" class="is-file" />
            <div class="is-hint">本地 ComfyUI 有参考图时自动使用核心图生图；云端需接口支持参考图（OpenAI 编辑 / Gemini 图像）。手动选的文件仅当前会话有效，角色库参考图会持久保存。</div>
          </div>

          <div class="is-field">
            <label>工作流</label>
            <select id="is-workflow-mode" class="text_pole">
              <option value="simple">内置工作流（有参考图时自动图生图）</option>
              <option value="custom">自定义 API 工作流</option>
            </select>
          </div>
          <div id="is-custom-workflow-wrap" class="is-subbox" hidden>
            <div class="is-subbox-title">自定义工作流（ComfyUI API 格式）</div>
            <div class="is-inline-actions">
              <input id="is-workflow-file" type="file" accept=".json,application/json" class="is-file" />
              <button type="button" class="is-link" id="is-load-ipadapter">载入 IPAdapter 模板</button>
              <button type="button" class="is-link" id="is-validate-workflow">检查</button>
            </div>
            <div class="is-hint">IPAdapter 模板需要 ComfyUI 已安装 IPAdapter Plus 节点和对应模型；缺少模型时 ComfyUI 会拒绝提交。</div>
            <textarea id="is-custom-workflow" class="text_pole is-textarea is-mono" rows="6" placeholder="粘贴 ComfyUI 导出的 API 格式 JSON"></textarea>
            <label class="checkbox_label"><input type="checkbox" id="is-auto-bind" /> 没有占位符时自动识别节点</label>
            <div class="is-hint">占位符：%positive% %negative% %seed% %steps% %cfg% %width% %height% %batch% %checkpoint% %sampler% %scheduler% %vae% %reference%</div>
            <div id="is-workflow-status" class="is-hint"></div>
          </div>
        </div>

        <div id="is-cloud-advanced" hidden>
          <div class="is-field">
            <label>额外请求体 JSON（仅本次生成）</label>
            <textarea id="is-cloud-extra" class="text_pole is-textarea is-mono" rows="3">{}</textarea>
          </div>
          <div class="is-hint">API 档案里的额外请求头/参数会一起合并；模型专属参数可写在这里。</div>
        </div>

        <label class="checkbox_label is-proxy-toggle"><input type="checkbox" id="is-use-proxy" /> 通过酒馆服务端代理请求（解决跨域，推荐）</label>
      </details>

      <div class="is-actions">
        <button type="button" id="is-generate" class="menu_button is-primary"><i class="fa-solid fa-wand-sparkles"></i> 生图</button>
        <button type="button" id="is-cancel" class="menu_button" hidden><i class="fa-solid fa-stop"></i> 停止</button>
      </div>

      <div id="is-job" class="is-job" hidden>
        <div class="is-job-top">
          <span id="is-job-status">准备中</span>
          <span id="is-job-time" class="is-hint"></span>
        </div>
        <div class="is-progress"><div id="is-progress-bar"></div></div>
        <div class="is-job-sub">
          <span id="is-node-label"></span>
          <span id="is-queue-label"></span>
        </div>
        <div id="is-ws-warning" class="is-hint is-ws-warning" hidden>实时预览不可用：新版 ComfyUI 会拒绝手机端的跨站 WebSocket。请在绘世/ComfyUI 启动参数加入 <code>--enable-cors-header "*"</code> 后重启；不影响出图。</div>
        <div class="is-preview-wrap">
          <img id="is-preview" alt="实时预览" hidden />
          <div id="is-preview-empty" class="is-hint">等待 ComfyUI 预览帧…</div>
        </div>
        <div id="is-job-error" class="is-error" hidden></div>
      </div>

      <div id="is-results" class="is-results"></div>

      <details class="is-request" id="is-request-details">
        <summary>实际发送的提示词 / 请求</summary>
        <div id="is-request-body"></div>
      </details>
    </section>

    <section class="is-pane" data-is-pane="monitor" hidden>
      <div class="is-card">
        <div class="is-card-title"><i class="fa-solid fa-plug"></i> ComfyUI 连接</div>
        <div class="is-field">
          <label>地址（PC 的局域网 IP）</label>
          <input id="is-comfy-url" class="text_pole" type="text" placeholder="http://192.168.1.10:8188" />
        </div>
        <div class="is-grid is-grid-2">
          <label>Basic 认证（可选）
            <input id="is-comfy-auth" class="text_pole" type="text" placeholder="user:password" />
          </label>
          <label>请求方式
            <select id="is-comfy-proxy" class="text_pole">
              <option value="proxy">酒馆服务端代理</option>
              <option value="direct">浏览器直连</option>
            </select>
          </label>
        </div>
        <div class="is-inline-actions">
          <button type="button" class="menu_button" id="is-test-comfy">一键连接</button>
          <button type="button" class="menu_button" id="is-scan-comfy">扫描局域网</button>
          <button type="button" class="menu_button" id="is-save-comfy">保存</button>
        </div>
        <div class="is-grid is-grid-2 is-scan-settings">
          <label>扫描前缀
            <input id="is-scan-prefix" class="text_pole" type="text" placeholder="192.168.1" />
          </label>
          <label>扫描端口
            <input id="is-scan-port" class="text_pole" type="number" min="1" max="65535" value="8188" />
          </label>
        </div>
        <div id="is-scan-progress" class="is-hint"></div>
        <div id="is-scan-results" class="is-scan-results"></div>
        <div id="is-comfy-status" class="is-hint"></div>
      </div>

      <div class="is-card">
        <div class="is-card-title"><i class="fa-solid fa-microchip"></i> PC 状态</div>
        <div class="is-stat-grid">
          <div><span class="is-stat-label">GPU</span><span id="is-stat-gpu" class="is-stat-value">—</span></div>
          <div><span class="is-stat-label">系统</span><span id="is-stat-os" class="is-stat-value">—</span></div>
          <div><span class="is-stat-label">ComfyUI</span><span id="is-stat-version" class="is-stat-value">—</span></div>
          <div><span class="is-stat-label">队列</span><span id="is-stat-queue" class="is-stat-value">—</span></div>
        </div>
        <div class="is-meter">
          <div class="is-meter-head"><span>显存</span><span id="is-stat-vram-text">—</span></div>
          <div class="is-meter-track"><div id="is-vram-bar"></div></div>
        </div>
        <div class="is-meter">
          <div class="is-meter-head"><span>内存</span><span id="is-stat-ram-text">—</span></div>
          <div class="is-meter-track"><div id="is-ram-bar"></div></div>
        </div>
        <div class="is-inline-actions is-right">
          <button type="button" class="is-link" id="is-refresh-monitor">刷新</button>
        </div>
      </div>

      <div class="is-card">
        <div class="is-card-title"><i class="fa-solid fa-list-check"></i> 队列 <span id="is-queue-count" class="is-hint"></span></div>
        <div id="is-queue-list" class="is-queue-list"><div class="is-hint">暂无数据</div></div>
        <div class="is-inline-actions">
          <button type="button" class="menu_button" id="is-interrupt">中断当前</button>
          <button type="button" class="menu_button" id="is-clear-queue">清空等待</button>
        </div>
      </div>

      <div class="is-card is-hints">
        <div class="is-card-title"><i class="fa-solid fa-circle-info"></i> 连不上时看这里</div>
        <ol>
          <li>手机和电脑要在同一个 Wi-Fi；这里填电脑的局域网 IP，不是 127.0.0.1。</li>
          <li>Windows 防火墙需要允许 ComfyUI 的端口（默认 8188），且网络类型为“专用”。</li>
          <li>画坊默认走酒馆服务端代理，可避开浏览器跨域；如果 App 里没开“让服务端充当跨域代理”，HTTP 会失败，WebSocket 仍可能可用。</li>
          <li>如果 App 开启了私网地址白名单，请把电脑 IP 或 192.168.0.0/16 加进允许列表。</li>
          <li>能出图但没有实时预览：新版 ComfyUI 会拒绝手机跨站 WebSocket。给绘世/ComfyUI 启动参数加 <code>--enable-cors-header "*"</code> 后重启。</li>
        </ol>
      </div>
    </section>

    <section class="is-pane" data-is-pane="library" hidden>
      <div class="is-card">
        <div class="is-card-title"><i class="fa-solid fa-address-book"></i> 角色库 <span id="is-library-char" class="is-hint"></span></div>
        <div class="is-hint">角色资料保存在当前角色卡的 <code>data.extensions.imageStudio.characterLibrary</code>。生成时会把选中角色的外貌/服装写进提示词，并在有参考图时用于图生图。</div>
        <div class="is-hint">AI 扫描会先用酒馆的激活规则取当前对话相关的世界书条目，再交给插件内部模型提炼外貌；角色卡和用户设定每次全字段扫描（超长字段会截断）。AI 失败会自动退回机械扫描。</div>
        <div class="is-field">
          <label for="is-library-scan-scope">世界书范围</label>
          <select id="is-library-scan-scope" class="text_pole">
            <option value="active">当前对话激活条目（推荐）</option>
            <option value="all">整本关联世界书（更慢、更耗 token）</option>
          </select>
        </div>
        <label class="checkbox_label"><input type="checkbox" id="is-library-ai-scan" checked /> 使用插件内部模型提炼外貌</label>
        <div class="is-inline-actions">
          <button type="button" class="menu_button" id="is-library-scan"><i class="fa-solid fa-magnifying-glass"></i> 扫描角色卡 / 世界书</button>
          <button type="button" class="menu_button" id="is-library-add"><i class="fa-solid fa-plus"></i> 添加角色</button>
        </div>
        <div class="is-inline-actions">
          <button type="button" class="menu_button" id="is-library-convert">AI 转所选提示词</button>
          <button type="button" class="menu_button is-primary" id="is-library-generate">用所选角色生图</button>
        </div>
        <div id="is-library-status" class="is-hint"></div>
      </div>

      <div id="is-library-candidates-wrap" class="is-card" hidden>
        <div class="is-card-title"><i class="fa-solid fa-wand-magic-sparkles"></i> 扫描候选 <span class="is-hint">勾选后加入角色库</span></div>
        <div id="is-library-candidates" class="is-library-candidates"></div>
        <div class="is-inline-actions">
          <button type="button" class="menu_button" id="is-library-add-selected">加入所选</button>
          <button type="button" class="is-link" id="is-library-clear-candidates">清空候选</button>
        </div>
      </div>

      <div id="is-library-list" class="is-library-list"></div>

      <div id="is-library-editor" class="is-card" hidden>
        <div class="is-card-title" id="is-library-editor-title">添加角色</div>
        <div class="is-field"><label>名称</label><input id="is-library-name" class="text_pole" type="text" /></div>
        <div class="is-field"><label>别名（逗号分隔）</label><input id="is-library-aliases" class="text_pole" type="text" /></div>
        <div class="is-field"><label>类型</label>
          <select id="is-library-role" class="text_pole">
            <option value="character">角色</option>
            <option value="user">用户角色</option>
            <option value="npc">NPC</option>
          </select>
        </div>
        <div class="is-field"><label>外貌 / 体貌</label><textarea id="is-library-appearance" class="text_pole is-textarea" rows="4"></textarea></div>
        <div class="is-field"><label>服装 / 配饰</label><textarea id="is-library-outfit" class="text_pole is-textarea" rows="2"></textarea></div>
        <div class="is-field"><label>生图提示词（AI 转换后可手改）</label><textarea id="is-library-prompt" class="text_pole is-textarea" rows="3"></textarea></div>
        <div class="is-field"><label>备注</label><textarea id="is-library-notes" class="text_pole is-textarea" rows="2"></textarea></div>
        <div class="is-field">
          <label>参考图（仅存档 / 预览）</label>
          <input id="is-library-reference-file" type="file" accept="image/*" class="is-file" />
          <div class="is-library-reference-row">
            <img id="is-library-reference-preview" class="is-library-reference" alt="角色参考图" hidden />
            <button type="button" class="is-link" id="is-library-reference-clear" hidden>移除参考图</button>
          </div>
        </div>
        <div class="is-inline-actions">
          <button type="button" class="menu_button is-primary" id="is-library-save">保存</button>
          <button type="button" class="menu_button" id="is-library-cancel">取消</button>
        </div>
      </div>
    </section>

    <section class="is-pane" data-is-pane="api" hidden>
      <div class="is-seg is-seg-wide" id="is-api-kind">
        <button type="button" data-is-api-kind="image" class="active"><i class="fa-solid fa-image"></i> 生图 API</button>
        <button type="button" data-is-api-kind="chat"><i class="fa-solid fa-comments"></i> 聊天 API</button>
      </div>
      <div class="is-inline-actions is-between">
        <button type="button" class="menu_button" id="is-add-api"><i class="fa-solid fa-plus"></i> 添加</button>
        <div class="is-inline-actions">
          <button type="button" class="is-link" id="is-import-chat">从酒馆导入当前聊天配置</button>
          <button type="button" class="is-link" id="is-refresh-balances">刷新全部余额</button>
        </div>
      </div>

      <div class="is-hint">API Key 保存在酒馆设置里，和酒馆其他 API Key 同级；不要分享 settings.json。</div>
      <div id="is-current-chat" class="is-brief is-current-chat"></div>

      <div class="is-card is-plugin-model">
        <div class="is-card-title"><i class="fa-solid fa-microchip"></i> 插件内部模型 <span class="is-hint">场景提取 · 角色挑选 · 角色库扫描 · 提示词改写</span></div>
        <div class="is-hint">只影响画坊自己的 AI 任务；不会切换或修改酒馆聊天 API、预设和角色扮演。可以单独选一个便宜的小模型，并限制附带的上下文条数。</div>
        <div class="is-field">
          <label for="is-plugin-mode">使用</label>
          <select id="is-plugin-mode" class="text_pole">
            <option value="current">跟随酒馆当前聊天 API</option>
            <option value="profile">画坊聊天 API 档案（可单独选模型）</option>
            <option value="connection">酒馆连接配置（不带预设）</option>
          </select>
        </div>
        <div id="is-plugin-profile-wrap" class="is-field" hidden>
          <label for="is-plugin-profile">画坊聊天 API</label>
          <select id="is-plugin-profile" class="text_pole"></select>
        </div>
        <div id="is-plugin-connection-wrap" class="is-field" hidden>
          <label for="is-plugin-connection">酒馆连接配置</label>
          <select id="is-plugin-connection" class="text_pole"></select>
        </div>
        <div class="is-field">
          <label for="is-plugin-context">附带最近消息数</label>
          <input id="is-plugin-context" class="text_pole" type="number" min="0" max="20" step="1" />
          <div class="is-hint">画坊请求里附带的消息条数；0 表示只发目标消息。酒馆预设可能再带自己的上下文；聊天记录本身不会改动。</div>
        </div>
        <div id="is-plugin-status" class="is-hint"></div>
      </div>

      <div id="is-api-list" class="is-api-list"></div>

      <div class="is-subbox">
        <div class="is-subbox-title">酒馆连接配置 <span class="is-hint">已有的多套聊天配置，可直接切换</span></div>
        <div id="is-connection-profiles" class="is-connection-list"></div>
      </div>

      <div id="is-api-editor" class="is-editor" hidden>
        <div class="is-card-title" id="is-editor-title">添加 API</div>
        <div class="is-field"><label>名称</label><input id="is-profile-name" class="text_pole" type="text" /></div>
        <div class="is-field"><label>类型</label><select id="is-profile-type" class="text_pole"></select><div id="is-profile-type-hint" class="is-hint"></div></div>
        <div class="is-field"><label>Base URL</label><input id="is-profile-base" class="text_pole" type="text" placeholder="https://..." /></div>
        <div class="is-field"><label>API Key</label><input id="is-profile-key" class="text_pole" type="password" autocomplete="off" /></div>
        <div class="is-field">
          <div class="is-field-head">
            <label>默认模型</label>
            <div class="is-inline-actions">
              <button type="button" class="is-link" id="is-fetch-models">获取模型</button>
            </div>
          </div>
          <input id="is-profile-model" class="text_pole" type="text" list="is-model-list" />
          <datalist id="is-model-list"></datalist>
          <div id="is-model-status" class="is-hint"></div>
          <div id="is-model-browser-wrap" class="is-model-browser-wrap">
            <div id="is-model-categories" class="is-chip-row"></div>
            <input id="is-model-search" class="text_pole" type="text" placeholder="筛选模型…" />
            <div id="is-model-browser" class="is-model-browser"></div>
          </div>
        </div>

        <div id="is-custom-fields" class="is-subbox" hidden>
          <div class="is-subbox-title">自定义请求</div>
          <div class="is-field"><label>URL / 模板</label><input id="is-custom-endpoint" class="text_pole" type="text" placeholder="https://..." /></div>
          <div class="is-field"><label>方法</label><select id="is-custom-method" class="text_pole"><option>POST</option><option>GET</option></select></div>
          <div class="is-field"><label>请求体 JSON（支持 {{prompt}} {{negative}} {{model}} {{width}} {{height}} {{seed}} {{n}} {{reference_base64}} {{referenceMime}}）</label><textarea id="is-custom-body" class="text_pole is-textarea is-mono" rows="4"></textarea></div>
          <div class="is-grid is-grid-2">
            <label>返回图片路径<input id="is-custom-response-path" class="text_pole" type="text" placeholder="data.0.b64_json" /></label>
            <label>图片格式<input id="is-custom-mime" class="text_pole" type="text" placeholder="image/png" /></label>
          </div>
        </div>

        <div class="is-field"><label>额外请求头 JSON</label><textarea id="is-profile-headers" class="text_pole is-textarea is-mono" rows="2">{}</textarea></div>
        <div class="is-field"><label>固定额外请求体 JSON</label><textarea id="is-profile-extra" class="text_pole is-textarea is-mono" rows="2">{}</textarea></div>

        <div class="is-field">
          <label>余额查询</label>
          <select id="is-profile-balance" class="text_pole"></select>
          <div id="is-balance-preset-hint" class="is-hint"></div>
        </div>
        <div id="is-balance-fields" class="is-subbox" hidden>
          <div class="is-inline-actions is-between"><span class="is-subbox-title">自定义余额接口</span></div>
          <div class="is-field"><label>URL</label><input id="is-balance-url" class="text_pole" type="text" placeholder="https://.../balance" /></div>
          <div class="is-grid is-grid-2">
            <label>方法<select id="is-balance-method" class="text_pole"><option>GET</option><option>POST</option></select></label>
            <label>单位<input id="is-balance-unit" class="text_pole" type="text" placeholder="¥ / $" /></label>
            <label>剩余字段<input id="is-balance-remaining" class="text_pole" type="text" placeholder="data.balance" /></label>
            <label>已用字段<input id="is-balance-used" class="text_pole" type="text" placeholder="data.used" /></label>
            <label>总额字段<input id="is-balance-total" class="text_pole" type="text" placeholder="data.total" /></label>
            <label>币种字段<input id="is-balance-currency" class="text_pole" type="text" placeholder="data.currency" /></label>
          </div>
          <div class="is-field"><label>额外请求头 JSON</label><textarea id="is-balance-headers" class="text_pole is-textarea is-mono" rows="2">{}</textarea></div>
        </div>

        <div class="is-inline-actions">
          <button type="button" class="menu_button is-primary" id="is-profile-save">保存</button>
          <button type="button" class="menu_button" id="is-profile-test">测试连接</button>
          <button type="button" class="menu_button" id="is-profile-cancel">取消</button>
        </div>
        <div id="is-profile-status" class="is-hint"></div>
      </div>
    </section>

    <section class="is-pane" data-is-pane="history" hidden>
      <div class="is-inline-actions is-between">
        <label class="checkbox_label"><input type="checkbox" id="is-autosave" /> 自动保存到酒馆图库</label>
        <button type="button" class="is-link" id="is-clear-history">清空记录</button>
      </div>
      <div id="is-history-list" class="is-history-list"></div>
    </section>
  </div>
</aside>

<div id="is-overlay" class="is-overlay" hidden></div>
<div id="is-lightbox" class="is-lightbox" hidden>
  <div class="is-lightbox-inner">
    <button type="button" class="is-icon-button is-lightbox-close" id="is-lb-close"><i class="fa-solid fa-xmark"></i></button>
    <img id="is-lb-img" alt="生成结果" />
    <div id="is-lb-meta" class="is-lightbox-meta"></div>
    <div class="is-inline-actions is-center">
      <button type="button" class="menu_button" id="is-lb-download"><i class="fa-solid fa-download"></i> 下载</button>
      <button type="button" class="menu_button" id="is-lb-bg"><i class="fa-solid fa-image"></i> 设为背景</button>
      <button type="button" class="menu_button" id="is-lb-chat"><i class="fa-solid fa-comment"></i> 插入聊天</button>
    </div>
  </div>
</div>
<div id="is-confirm" class="is-confirm" hidden>
  <div class="is-confirm-panel">
    <div class="is-confirm-head">
      <b><i class="fa-solid fa-wand-magic-sparkles"></i> 确认生图</b>
      <button type="button" class="is-icon-button" id="is-confirm-close"><i class="fa-solid fa-xmark"></i></button>
    </div>
    <div id="is-confirm-target" class="is-hint"></div>
    <div class="is-field">
      <label>场景提示词（可编辑）</label>
      <textarea id="is-confirm-scene" class="text_pole is-textarea" rows="4" placeholder="描述场景；留空则生成角色展示图"></textarea>
    </div>
    <details class="is-negative-wrap">
      <summary>负面提示词</summary>
      <textarea id="is-confirm-negative" class="text_pole is-textarea" rows="2"></textarea>
    </details>
    <div class="is-field">
      <div class="is-field-head"><label>角色库角色</label><span class="is-hint">勾选后会追加外貌/服装文字</span></div>
      <div id="is-confirm-characters" class="is-confirm-characters"></div>
      <div id="is-confirm-refs" class="is-confirm-refs"></div>
      <div><button type="button" class="is-link" id="is-confirm-open-library">编辑角色库</button></div>
    </div>
    <details class="is-request">
      <summary>最终提示词预览</summary>
      <pre id="is-confirm-final"></pre>
    </details>
    <div class="is-hint">生成时使用第一个有参考图的选中角色：本地 ComfyUI 自动走核心图生图，云端需接口支持参考图；不支持时会提示并按文字生成。</div>
    <div class="is-inline-actions is-right">
      <button type="button" class="menu_button" id="is-confirm-cancel">取消</button>
      <button type="button" class="menu_button is-primary" id="is-confirm-generate">生成</button>
    </div>
    <div id="is-confirm-status" class="is-hint"></div>
  </div>
</div>
<div id="is-rewrite-overlay" class="is-overlay" hidden></div>
`;
}

export function wandItemTemplate() {
    return `
<div id="is-wand" class="list-group-item flex-container flexGap5">
  <div class="fa-solid fa-palette extensionsMenuExtensionButton" title="画坊 Image Studio"></div>
  <span>画坊</span>
</div>`;
}

export function settingsDrawerTemplate() {
    return `
<div class="inline-drawer is-settings-drawer" id="is-settings-drawer">
  <div class="inline-drawer-toggle inline-drawer-header">
    <b><i class="fa-solid fa-palette"></i> 画坊 · Image Studio</b>
    <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
  </div>
  <div class="inline-drawer-content">
    <div class="is-hint">本地 ComfyUI 生图、云端生图、API 与余额管理。默认手动写提示词，需要时再让插件内部模型改写。</div>
    <div class="is-inline-actions">
      <button type="button" class="menu_button" id="is-open-from-settings">打开画坊</button>
      <span id="is-settings-status" class="is-hint"></span>
    </div>
  </div>
</div>`;
}
