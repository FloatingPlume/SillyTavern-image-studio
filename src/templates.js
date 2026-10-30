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
        <button type="button" class="is-link" id="is-quick-test">检测</button>
      </div>

      <div id="is-cloud-bar" class="is-field" hidden>
        <label for="is-cloud-profile">生图 API</label>
        <select id="is-cloud-profile" class="text_pole"></select>
        <div id="is-cloud-hint" class="is-hint"></div>
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
        <div class="is-subbox-title">让聊天模型写成生图提示词 <span class="is-hint">会消耗一次聊天请求</span></div>
        <input id="is-rewrite-intent" class="text_pole" type="text" placeholder="画面意图（可留空，例如：雨后屋檐下回头）" />
        <div class="is-grid is-grid-2">
          <label>风格
            <select id="is-rewrite-style" class="text_pole">
              <option value="tags">标签风（SD / Danbooru）</option>
              <option value="natural">自然语言（Gemini / GPT Image）</option>
            </select>
          </label>
          <label>使用
            <select id="is-rewrite-source" class="text_pole">
              <option value="current">酒馆当前聊天 API</option>
              <option value="profile">画坊聊天档案</option>
              <option value="connection">酒馆连接配置</option>
            </select>
          </label>
        </div>
        <div id="is-rewrite-profile-wrap" class="is-field" hidden>
          <label>画坊聊天档案</label>
          <select id="is-rewrite-profile" class="text_pole"></select>
        </div>
        <div id="is-rewrite-connection-wrap" class="is-field" hidden>
          <label>酒馆连接配置</label>
          <select id="is-rewrite-connection" class="text_pole"></select>
        </div>
        <div class="is-inline-actions is-right">
          <button type="button" class="menu_button" id="is-rewrite-run">改写</button>
        </div>
        <div id="is-rewrite-status" class="is-hint"></div>
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
        <input id="is-cloud-model" class="text_pole" type="text" placeholder="gpt-image-1 / gemini-2.5-flash-image" />
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
            <label>工作流</label>
            <select id="is-workflow-mode" class="text_pole">
              <option value="simple">内置简单工作流</option>
              <option value="custom">自定义 API 工作流</option>
            </select>
          </div>
          <div id="is-custom-workflow-wrap" class="is-subbox" hidden>
            <div class="is-subbox-title">自定义工作流（ComfyUI API 格式）</div>
            <div class="is-inline-actions">
              <input id="is-workflow-file" type="file" accept=".json,application/json" class="is-file" />
              <button type="button" class="is-link" id="is-validate-workflow">检查</button>
            </div>
            <textarea id="is-custom-workflow" class="text_pole is-textarea is-mono" rows="6" placeholder="粘贴 ComfyUI 导出的 API 格式 JSON"></textarea>
            <label class="checkbox_label"><input type="checkbox" id="is-auto-bind" /> 没有占位符时自动识别节点</label>
            <div class="is-hint">占位符：%positive% %negative% %seed% %steps% %cfg% %width% %height% %batch% %checkpoint% %sampler% %scheduler% %vae%</div>
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
          <button type="button" class="menu_button" id="is-test-comfy">检测并读取模型</button>
          <button type="button" class="menu_button" id="is-save-comfy">保存</button>
        </div>
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
        </ol>
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
        <div class="is-field"><label>默认模型</label><input id="is-profile-model" class="text_pole" type="text" list="is-model-list" /><datalist id="is-model-list"></datalist></div>

        <div id="is-custom-fields" class="is-subbox" hidden>
          <div class="is-subbox-title">自定义请求</div>
          <div class="is-field"><label>URL / 模板</label><input id="is-custom-endpoint" class="text_pole" type="text" placeholder="https://..." /></div>
          <div class="is-field"><label>方法</label><select id="is-custom-method" class="text_pole"><option>POST</option><option>GET</option></select></div>
          <div class="is-field"><label>请求体 JSON（支持 {{prompt}} {{negative}} {{model}} {{width}} {{height}} {{seed}} {{n}}）</label><textarea id="is-custom-body" class="text_pole is-textarea is-mono" rows="4"></textarea></div>
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
    <div class="is-hint">本地 ComfyUI 生图、云端生图、API 与余额管理。默认手动写提示词，需要时再让聊天模型改写。</div>
    <div class="is-inline-actions">
      <button type="button" class="menu_button" id="is-open-from-settings">打开画坊</button>
      <span id="is-settings-status" class="is-hint"></span>
    </div>
  </div>
</div>`;
}
