window.__ModuleLoader__.load({
  id: '@local/auto-compact',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const NS = 'autoCompaction'
    const STATUS_URL = '/auto-compact/status'
    const CONFIG_URL = '/auto-compact/config'
    const COMPACT_URL = '/auto-compact/compact'

    const en = {
      'nav': 'Compaction',
      'page.title': 'Auto compaction',
      'page.subtitle': 'Condense the context at an absolute token budget, not a window ratio.',
      'status.title': 'Live state',
      'status.pressure': 'Context pressure',
      'status.threshold': 'Effective trigger',
      'status.configured': 'Configured budget',
      'status.window': 'Model window',
      'status.unknown': 'no live session yet',
      'status.counters': 'Checks {checks} · triggers {triggers} · compactions {compactions} · prunes {prunes}',
      'status.lastCompaction': 'Last compaction: {from} → {to}',
      'status.lastManual': 'Last compaction: manual',
      'status.sessions': 'Busiest session',
      'form.title': 'Budget',
      'form.threshold': 'Trigger at (tokens)',
      'form.thresholdHint': 'Measured context pressure that starts compaction. Default 200000.',
      'form.retain': 'Keep verbatim (tokens)',
      'form.retainHint': 'Recent tail left untouched after condensing. Must stay below the trigger.',
      'form.enabled': 'Enabled',
      'form.enabledHint': 'Turn the pre-step trigger off without uninstalling the plugin.',
      'form.pruneFirst': 'Trim tool output first',
      'form.pruneFirstHint': 'Reclaim oversized tool results before paying for a summary.',
      'form.save': 'Save',
      'form.saving': 'Saving…',
      'form.reset': 'Reset to defaults',
      'form.refresh': 'Refresh',
      'form.compact': 'Compact now',
      'form.compacting': 'Compacting…',
      'form.saved': 'Saved. Applies from the next step.',
      'form.clamped': 'The model window clamps this budget to {value}.',
      'error.load': 'Cannot read the plugin state: {message}',
      'override.active': 'Runtime override: {path}',
      'override.inactive': 'Runtime override: none (bundle defaults in use)',
    }

    const vi = {
      'nav': 'Nén ngữ cảnh',
      'page.title': 'Tự nén ngữ cảnh',
      'page.subtitle': 'Nén theo ngưỡng token tuyệt đối, không theo tỉ lệ cửa sổ model.',
      'status.title': 'Trạng thái hiện tại',
      'status.pressure': 'Ngữ cảnh đang dùng',
      'status.threshold': 'Ngưỡng hiệu lực',
      'status.configured': 'Ngưỡng đã đặt',
      'status.window': 'Cửa sổ model',
      'status.unknown': 'chưa có session đang chạy',
      'status.counters': 'Kiểm {checks} · chạm ngưỡng {triggers} · đã nén {compactions} · đã tỉa {prunes}',
      'status.lastCompaction': 'Lần nén gần nhất: {from} → {to}',
      'status.lastManual': 'Lần nén gần nhất: thủ công',
      'status.sessions': 'Session căng nhất',
      'form.title': 'Ngưỡng',
      'form.threshold': 'Nén khi đạt (token)',
      'form.thresholdHint': 'Mức token đo được để bắt đầu nén. Mặc định 200000.',
      'form.retain': 'Giữ nguyên (token)',
      'form.retainHint': 'Phần đuôi gần nhất không bị nén. Phải nhỏ hơn ngưỡng.',
      'form.enabled': 'Bật',
      'form.enabledHint': 'Tắt trigger trước mỗi bước mà không cần gỡ plugin.',
      'form.pruneFirst': 'Tỉa tool output trước',
      'form.pruneFirstHint': 'Thu hồi kết quả tool quá khổ trước khi trả tiền cho một lần tóm tắt.',
      'form.save': 'Lưu',
      'form.saving': 'Đang lưu…',
      'form.reset': 'Về mặc định',
      'form.refresh': 'Làm mới',
      'form.compact': 'Nén ngay',
      'form.compacting': 'Đang nén…',
      'form.saved': 'Đã lưu. Áp dụng từ bước tiếp theo.',
      'form.clamped': 'Cửa sổ model kéo ngưỡng này xuống {value}.',
      'error.load': 'Không đọc được trạng thái plugin: {message}',
      'override.active': 'File override: {path}',
      'override.inactive': 'File override: chưa có (đang dùng mặc định của bundle)',
    }

    function fmtTokens(value) {
      if (typeof value !== 'number' || !Number.isFinite(value)) return '—'
      if (value >= 1e6) return `${(value / 1e6).toFixed(2)}M`
      if (value >= 1e3) return `${(value / 1e3).toFixed(1)}k`
      return String(value)
    }

    const styles = {
      page: {
        display: 'flex',
        flexDirection: 'column',
        gap: 16,
        maxWidth: 720,
        color: 'var(--dsw-alias-label-primary)',
        fontSize: 13,
        lineHeight: '20px',
      },
      title: { margin: 0, fontSize: 15, fontWeight: 600 },
      subtitle: { margin: '2px 0 0', color: 'var(--dsw-alias-label-secondary)', fontSize: 12 },
      card: {
        padding: 14,
        borderRadius: 8,
        border: '1px solid var(--dsw-alias-border-l1)',
        background: 'var(--dsw-alias-bg-l2, transparent)',
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
      },
      cardTitle: {
        margin: 0,
        fontSize: 11,
        fontWeight: 600,
        letterSpacing: '0.04em',
        textTransform: 'uppercase',
        color: 'var(--dsw-alias-label-secondary)',
      },
      grid: {
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
        gap: 10,
      },
      metricLabel: { color: 'var(--dsw-alias-label-secondary)', fontSize: 11 },
      metricValue: { fontSize: 14, fontVariantNumeric: 'tabular-nums' },
      bar: {
        height: 4,
        borderRadius: 999,
        background: 'var(--dsw-alias-border-l1)',
        overflow: 'hidden',
        marginTop: 2,
      },
      barFill: { height: '100%' },
      row: {
        display: 'grid',
        gridTemplateColumns: '1fr minmax(160px, 220px)',
        gap: 12,
        alignItems: 'start',
      },
      hint: { color: 'var(--dsw-alias-label-secondary)', fontSize: 11, margin: '2px 0 0' },
      input: {
        width: '100%',
        boxSizing: 'border-box',
        padding: '5px 8px',
        borderRadius: 6,
        border: '1px solid var(--dsw-alias-border-l1)',
        background: 'var(--dsw-alias-bg-l1, transparent)',
        color: 'var(--dsw-alias-label-primary)',
        font: 'inherit',
        fontVariantNumeric: 'tabular-nums',
      },
      presets: { display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 4 },
      button: {
        padding: '5px 10px',
        borderRadius: 6,
        border: '1px solid var(--dsw-alias-border-l1)',
        background: 'transparent',
        color: 'var(--dsw-alias-label-primary)',
        font: 'inherit',
        cursor: 'pointer',
      },
      primary: {
        padding: '5px 12px',
        borderRadius: 6,
        border: '1px solid var(--dsw-alias-state-success-primary, currentColor)',
        background: 'var(--dsw-alias-state-success-primary, transparent)',
        color: 'var(--dsw-alias-bg-l1, #fff)',
        font: 'inherit',
        cursor: 'pointer',
      },
      actions: { display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' },
      note: { color: 'var(--dsw-alias-label-secondary)', fontSize: 11 },
      error: { color: 'var(--dsw-alias-state-error-primary, crimson)', fontSize: 12 },
      switchRow: {
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        cursor: 'pointer',
        userSelect: 'none',
      },
    }

    function Metric({ label, value, bar }) {
      return h('div', null, [
        h('div', { key: 'l', style: styles.metricLabel }, label),
        h('div', { key: 'v', style: styles.metricValue }, value),
        bar === undefined
          ? null
          : h('div', { key: 'b', style: styles.bar }, h('div', {
            style: { ...styles.barFill, width: `${Math.max(0, Math.min(1, bar)) * 100}%`, background: bar >= 0.9 ? 'var(--dsw-alias-state-warn-primary)' : 'var(--dsw-alias-state-success-primary)' },
          })),
      ])
    }

    function Toggle({ label, hint, checked, onChange, disabled }) {
      return h('label', { style: { ...styles.switchRow, opacity: disabled ? 0.6 : 1 } }, [
        h('input', {
          key: 'i',
          type: 'checkbox',
          checked: checked,
          disabled,
          onChange: (event) => onChange(event.target.checked),
        }),
        h('span', { key: 't' }, [
          h('div', { key: 'l' }, label),
          h('div', { key: 'h', style: styles.hint }, hint),
        ]),
      ])
    }

    const PRESETS = [50000, 100000, 150000, 200000, 300000, 400000]

    function CompactionSection(props) {
      const t = props.t
      const [snapshot, setSnapshot] = React.useState(null)
      const [draft, setDraft] = React.useState(null)
      const [busy, setBusy] = React.useState('')
      const [notice, setNotice] = React.useState('')
      const [error, setError] = React.useState('')

      const applySnapshot = React.useCallback((value) => {
        setSnapshot(value)
        setDraft({
          threshold: String(value.config.threshold_tokens),
          retain: String(value.config.retain_tokens),
          enabled: value.config.enabled,
          pruneFirst: value.config.prune_first,
        })
      }, [])

      const load = React.useCallback(() => {
        setError('')
        fetch(STATUS_URL, { cache: 'no-store' })
          .then((response) => {
            if (!response.ok) throw new Error(`HTTP ${response.status}`)
            return response.json()
          })
          .then(applySnapshot)
          .catch((cause) => setError(t('error.load', { message: cause instanceof Error ? cause.message : String(cause) })))
      }, [t, applySnapshot])

      React.useEffect(() => {
        load()
      }, [load])

      const save = (reset) => {
        setBusy(reset ? 'reset' : 'save')
        setNotice('')
        setError('')
        const body = reset
          ? { reset: true }
          : {
            thresholdTokens: Number(draft.threshold),
            retainTokens: Number(draft.retain),
            enabled: draft.enabled,
            pruneFirst: draft.pruneFirst,
          }
        fetch(CONFIG_URL, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
          cache: 'no-store',
        })
          .then(async (response) => {
            const payload = await response.json()
            if (!response.ok) throw new Error(payload?.error ?? `HTTP ${response.status}`)
            applySnapshot(payload)
            setNotice(t('form.saved'))
          })
          .catch((cause) => setError(cause instanceof Error ? cause.message : String(cause)))
          .finally(() => setBusy(''))
      }

      const compactNow = () => {
        setBusy('compact')
        setNotice('')
        setError('')
        fetch(COMPACT_URL, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}', cache: 'no-store' })
          .then(async (response) => {
            const payload = await response.json()
            if (!response.ok) throw new Error(payload?.error ?? `HTTP ${response.status}`)
            load()
          })
          .catch((cause) => setError(cause instanceof Error ? cause.message : String(cause)))
          .finally(() => setBusy(''))
      }

      const header = h('div', { key: 'head' }, [
        h('h2', { key: 't', style: styles.title }, t('page.title')),
        h('p', { key: 's', style: styles.subtitle }, t('page.subtitle')),
      ])

      if (snapshot === null || draft === null) {
        return h('div', { style: styles.page }, [
          header,
          error === '' ? h('div', { key: 'load', style: styles.note }, t('form.refresh')) : h('div', { key: 'err', style: styles.error }, error),
        ])
      }

      const window = snapshot.context_window
      const pressure = snapshot.pressure_tokens
      const ratio = typeof window === 'number' && window > 0 && typeof pressure === 'number' ? pressure / window : 0
      const thresholdDraft = Number(draft.threshold)
      const plannedEffective = typeof window === 'number' && Number.isFinite(thresholdDraft) && thresholdDraft > 0
        ? Math.min(thresholdDraft, Math.floor(window * snapshot.config.cap_ratio))
        : null
      const clamped = plannedEffective !== null && plannedEffective !== thresholdDraft
      const counters = snapshot.counters
      const last = snapshot.last_compaction

      return h('div', { style: styles.page }, [
        header,
        h('section', { key: 'status', style: styles.card }, [
          h('h3', { key: 't', style: styles.cardTitle }, t('status.title')),
          h('div', { key: 'grid', style: styles.grid }, [
            h(Metric, {
              key: 'p',
              label: t('status.pressure'),
              value: typeof pressure === 'number' ? `${fmtTokens(pressure)}${typeof window === 'number' ? ` / ${fmtTokens(window)}` : ''}` : t('status.unknown'),
              bar: ratio,
            }),
            h(Metric, { key: 'e', label: t('status.threshold'), value: fmtTokens(snapshot.effective_threshold_tokens) }),
            h(Metric, { key: 'c', label: t('status.configured'), value: fmtTokens(snapshot.config.threshold_tokens) }),
          ]),
          h('div', { key: 'counters', style: styles.note }, t('status.counters', {
            checks: counters.checks,
            triggers: counters.triggers,
            compactions: counters.compactions,
            prunes: counters.pruned,
          })),
          last === null || last === undefined
            ? null
            : h('div', { key: 'last', style: styles.note }, last.tokens_before === null || last.freed_tokens === null
              ? t('status.lastManual')
              : t('status.lastCompaction', { from: fmtTokens(last.tokens_before), to: fmtTokens(last.tokens_after) })),
          snapshot.override_active
            ? h('div', { key: 'ovr', style: styles.note }, t('override.active', { path: snapshot.override_path }))
            : h('div', { key: 'ovr', style: styles.note }, t('override.inactive')),
        ]),
        h('section', { key: 'form', style: styles.card }, [
          h('h3', { key: 't', style: styles.cardTitle }, t('form.title')),
          h('div', { key: 'threshold', style: styles.row }, [
            h('div', { key: 'l' }, [
              h('div', { key: 'n' }, t('form.threshold')),
              h('div', { key: 'h', style: styles.hint }, t('form.thresholdHint')),
              h('div', { key: 'p', style: styles.presets }, PRESETS.map((value) => h('button', {
                key: value,
                type: 'button',
                style: styles.button,
                onClick: () => setDraft((current) => ({ ...current, threshold: String(value) })),
              }, fmtTokens(value)))),
            ]),
            h('div', { key: 'i' }, [
              h('input', {
                key: 'in',
                style: styles.input,
                type: 'number',
                min: 1000,
                step: 1000,
                value: draft.threshold,
                onChange: (event) => setDraft((current) => ({ ...current, threshold: event.target.value })),
              }),
              clamped ? h('div', { key: 'c', style: styles.hint }, t('form.clamped', { value: fmtTokens(plannedEffective) })) : null,
            ]),
          ]),
          h('div', { key: 'retain', style: styles.row }, [
            h('div', { key: 'l' }, [
              h('div', { key: 'n' }, t('form.retain')),
              h('div', { key: 'h', style: styles.hint }, t('form.retainHint')),
            ]),
            h('input', {
              key: 'i',
              style: styles.input,
              type: 'number',
              min: 0,
              step: 1000,
              value: draft.retain,
              onChange: (event) => setDraft((current) => ({ ...current, retain: event.target.value })),
            }),
          ]),
          h('div', { key: 'toggles', style: { display: 'flex', flexDirection: 'column', gap: 8 } }, [
            h(Toggle, {
              key: 'enabled',
              label: t('form.enabled'),
              hint: t('form.enabledHint'),
              checked: draft.enabled,
              onChange: (value) => setDraft((current) => ({ ...current, enabled: value })),
            }),
            h(Toggle, {
              key: 'prune',
              label: t('form.pruneFirst'),
              hint: t('form.pruneFirstHint'),
              checked: draft.pruneFirst,
              onChange: (value) => setDraft((current) => ({ ...current, pruneFirst: value })),
            }),
          ]),
          h('div', { key: 'actions', style: styles.actions }, [
            h('button', {
              key: 'save',
              type: 'button',
              style: styles.primary,
              disabled: busy !== '',
              onClick: () => save(false),
            }, busy === 'save' ? t('form.saving') : t('form.save')),
            h('button', {
              key: 'reset',
              type: 'button',
              style: styles.button,
              disabled: busy !== '',
              onClick: () => save(true),
            }, t('form.reset')),
            h('button', {
              key: 'compact',
              type: 'button',
              style: styles.button,
              disabled: busy !== '',
              onClick: compactNow,
            }, busy === 'compact' ? t('form.compacting') : t('form.compact')),
            h('button', {
              key: 'refresh',
              type: 'button',
              style: styles.button,
              disabled: busy !== '',
              onClick: load,
            }, t('form.refresh')),
            notice === '' ? null : h('span', { key: 'n', style: styles.note }, notice),
          ]),
          error === '' ? null : h('div', { key: 'err', style: styles.error }, error),
        ]),
      ])
    }

    const inject = ['slots', 'locale']

    function apply(ctx) {
      ctx.effect(() => ctx.locale.register(NS, { en, vi }), 'auto-compact: dictionaries')
      const t = ctx.locale.bind(NS)
      ctx.slots.inject('settings.section', () => ctx.slots.register({
        name: 'settings.section',
        id: 'auto-compact',
        order: 70,
        label: () => t('nav'),
        locale: NS,
      }, () => h(CompactionSection, { t })))
    }

    return { inject, apply }
  },
})
