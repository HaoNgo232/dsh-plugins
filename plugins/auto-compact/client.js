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
      'page.subtitle': 'When a chat gets too long, older turns are summarized so the conversation can keep going.',
      'state.on': 'On',
      'state.off': 'Off',
      'usage.left': '{value} left',
      'usage.over': 'over budget — condensing on the next step',
      'usage.noSession': 'No open chat yet, so there is nothing to measure.',
      'usage.window': 'Model window {value}',
      'usage.clamped': 'Capped at {value} by the model window',
      'form.budget': 'Condense when the chat reaches',
      'form.budgetUnit': 'tokens',
      'form.budgetHint': 'Default 200000 — about one fifth of a 1M-token window.',
      'form.enabled': 'Condense automatically',
      'form.advanced': 'Advanced',
      'form.retain': 'Always keep the newest',
      'form.retainHint': 'In tokens. This part is never summarized.',
      'form.prune': 'Trim long tool output first',
      'form.pruneHint': 'Cheaper than summarizing, and often enough on its own.',
      'form.details': 'Details',
      'form.counters': 'Measured {checks} times · condensed {compactions} times',
      'form.lastCompaction': 'Last condensation: {from} → {to}',
      'form.noCompaction': 'Nothing has been condensed yet.',
      'form.override': 'Settings saved in {path}',
      'form.overrideNone': 'Using the bundled defaults.',
      'form.save': 'Save',
      'form.saving': 'Saving…',
      'form.reset': 'Reset to defaults',
      'form.compact': 'Condense now',
      'form.compacting': 'Condensing…',
      'form.saved': 'Saved.',
      'form.error': 'Could not save: {message}',
      'form.loadError': 'Could not read the current state: {message}',
      'form.loading': 'Loading…',
    }

    const vi = {
      'nav': 'Nén ngữ cảnh',
      'page.title': 'Tự nén ngữ cảnh',
      'page.subtitle': 'Khi cuộc trò chuyện quá dài, các lượt cũ được tóm tắt để chat tiếp tục được.',
      'state.on': 'Đang bật',
      'state.off': 'Đang tắt',
      'usage.left': 'còn {value}',
      'usage.over': 'đã vượt ngưỡng — sẽ nén ở bước sau',
      'usage.noSession': 'Chưa có chat nào đang mở nên chưa đo được.',
      'usage.window': 'Cửa sổ model {value}',
      'usage.clamped': 'Bị cửa sổ model giới hạn ở {value}',
      'form.budget': 'Nén khi chat đạt',
      'form.budgetUnit': 'token',
      'form.budgetHint': 'Mặc định 200000 — khoảng một phần năm của cửa sổ 1M token.',
      'form.enabled': 'Tự động nén',
      'form.advanced': 'Nâng cao',
      'form.retain': 'Luôn giữ phần mới nhất',
      'form.retainHint': 'Tính bằng token. Phần này không bao giờ bị tóm tắt.',
      'form.prune': 'Tỉa kết quả tool dài trước',
      'form.pruneHint': 'Rẻ hơn tóm tắt, và thường đã đủ để khỏi phải nén.',
      'form.details': 'Chi tiết',
      'form.counters': 'Đã đo {checks} lần · đã nén {compactions} lần',
      'form.lastCompaction': 'Lần nén gần nhất: {from} → {to}',
      'form.noCompaction': 'Chưa nén lần nào.',
      'form.override': 'Thiết lập lưu tại {path}',
      'form.overrideNone': 'Đang dùng giá trị mặc định của bundle.',
      'form.save': 'Lưu',
      'form.saving': 'Đang lưu…',
      'form.reset': 'Về mặc định',
      'form.compact': 'Nén ngay',
      'form.compacting': 'Đang nén…',
      'form.saved': 'Đã lưu.',
      'form.error': 'Không lưu được: {message}',
      'form.loadError': 'Không đọc được trạng thái hiện tại: {message}',
      'form.loading': 'Đang tải…',
    }

    function fmt(value) {
      if (typeof value !== 'number' || !Number.isFinite(value)) return '—'
      if (value >= 1e6) return `${(value / 1e6).toFixed(2)}M`
      if (value >= 1e3) return `${(value / 1e3).toFixed(1)}k`
      return String(value)
    }

    const styles = {
      page: {
        display: 'flex',
        flexDirection: 'column',
        gap: 14,
        maxWidth: 640,
        color: 'var(--dsw-alias-label-primary)',
        fontSize: 13,
        lineHeight: '20px',
      },
      head: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 },
      title: { margin: 0, fontSize: 15, fontWeight: 600 },
      subtitle: { margin: '4px 0 0', color: 'var(--dsw-alias-label-secondary)', fontSize: 12, maxWidth: 460 },
      pill: {
        flex: 'none',
        padding: '1px 8px',
        borderRadius: 999,
        border: '1px solid var(--dsw-alias-border-l1)',
        fontSize: 11,
        color: 'var(--dsw-alias-label-secondary)',
      },
      card: {
        padding: 14,
        borderRadius: 8,
        border: '1px solid var(--dsw-alias-border-l1)',
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
      },
      usageTop: { display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10 },
      usageMain: { fontSize: 18, fontVariantNumeric: 'tabular-nums' },
      usageMuted: { color: 'var(--dsw-alias-label-secondary)', fontSize: 12, fontVariantNumeric: 'tabular-nums' },
      bar: { height: 6, borderRadius: 999, background: 'var(--dsw-alias-border-l1)', overflow: 'hidden' },
      note: { color: 'var(--dsw-alias-label-secondary)', fontSize: 11 },
      fieldRow: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
      fieldLabel: { fontSize: 13 },
      hint: { color: 'var(--dsw-alias-label-secondary)', fontSize: 11, margin: '2px 0 0' },
      inputWrap: { display: 'flex', alignItems: 'center', gap: 6, flex: 'none' },
      input: {
        width: 110,
        boxSizing: 'border-box',
        padding: '5px 8px',
        borderRadius: 6,
        border: '1px solid var(--dsw-alias-border-l1)',
        background: 'transparent',
        color: 'var(--dsw-alias-label-primary)',
        font: 'inherit',
        textAlign: 'right',
        fontVariantNumeric: 'tabular-nums',
      },
      presets: { display: 'flex', flexWrap: 'wrap', gap: 6 },
      button: {
        padding: '4px 10px',
        borderRadius: 6,
        border: '1px solid var(--dsw-alias-border-l1)',
        background: 'transparent',
        color: 'var(--dsw-alias-label-primary)',
        font: 'inherit',
        cursor: 'pointer',
      },
      primary: {
        padding: '5px 14px',
        borderRadius: 6,
        border: '1px solid var(--dsw-alias-state-success-primary, currentColor)',
        background: 'var(--dsw-alias-state-success-primary, transparent)',
        color: 'var(--dsw-alias-bg-l1, #fff)',
        font: 'inherit',
        cursor: 'pointer',
      },
      actions: { display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' },
      toggle: { display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', userSelect: 'none' },
      summary: { cursor: 'pointer', fontSize: 12, color: 'var(--dsw-alias-label-secondary)' },
      error: { color: 'var(--dsw-alias-state-error-primary, crimson)', fontSize: 12 },
      mono: { fontSize: 11, wordBreak: 'break-all' },
    }

    const PRESETS = [100000, 150000, 200000, 300000, 400000]

    function CompactionSection(props) {
      const t = props.t
      const [snapshot, setSnapshot] = React.useState(null)
      const [draft, setDraft] = React.useState(null)
      const [busy, setBusy] = React.useState('')
      const [notice, setNotice] = React.useState('')
      const [error, setError] = React.useState('')

      const adopt = React.useCallback((value) => {
        setSnapshot(value)
        setDraft({
          threshold: String(value.config.threshold_tokens),
          retain: String(value.config.retain_tokens),
          enabled: value.config.enabled,
          prune: value.config.prune_first,
        })
      }, [])

      const load = React.useCallback(() => {
        setError('')
        fetch(STATUS_URL, { cache: 'no-store' })
          .then((response) => {
            if (!response.ok) throw new Error(`HTTP ${response.status}`)
            return response.json()
          })
          .then(adopt)
          .catch((cause) => setError(t('form.loadError', { message: cause instanceof Error ? cause.message : String(cause) })))
      }, [t, adopt])

      React.useEffect(() => {
        load()
      }, [load])

      const send = (url, body, kind) => {
        setBusy(kind)
        setNotice('')
        setError('')
        return fetch(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
          cache: 'no-store',
        })
          .then(async (response) => {
            const payload = await response.json()
            if (!response.ok) throw new Error(payload?.error ?? `HTTP ${response.status}`)
            return payload
          })
          .catch((cause) => {
            setError(t('form.error', { message: cause instanceof Error ? cause.message : String(cause) }))
            return null
          })
          .finally(() => setBusy(''))
      }

      const save = (reset) => {
        send(
          CONFIG_URL,
          reset
            ? { reset: true }
            : {
              thresholdTokens: Number(draft.threshold),
              retainTokens: Number(draft.retain),
              enabled: draft.enabled,
              pruneFirst: draft.prune,
            },
          reset ? 'reset' : 'save',
        ).then((payload) => {
          if (payload === null) return
          adopt(payload)
          setNotice(t('form.saved'))
        })
      }

      const condense = () => {
        send(COMPACT_URL, {}, 'compact').then((payload) => {
          if (payload !== null) load()
        })
      }

      const header = h('div', { key: 'head', style: styles.head }, [
        h('div', { key: 'text' }, [
          h('h2', { key: 't', style: styles.title }, t('page.title')),
          h('p', { key: 's', style: styles.subtitle }, t('page.subtitle')),
        ]),
        snapshot === null
          ? null
          : h('span', { key: 'pill', style: styles.pill }, snapshot.config.enabled ? t('state.on') : t('state.off')),
      ])

      if (snapshot === null || draft === null) {
        return h('div', { style: styles.page }, [
          header,
          error === '' ? h('div', { key: 'w', style: styles.note }, t('form.loading')) : h('div', { key: 'e', style: styles.error }, error),
        ])
      }

      const used = snapshot.pressure_tokens
      const typed = Number(draft.threshold)
      const budget = Number.isFinite(typed) && typed > 0 ? typed : snapshot.config.threshold_tokens
      const modelWindow = snapshot.context_window
      const clampedAt = typeof modelWindow === 'number'
        ? Math.min(budget, Math.floor(modelWindow * snapshot.config.cap_ratio))
        : null
      const over = typeof used === 'number' && used >= budget
      const ratio = typeof used === 'number' && budget > 0 ? used / budget : 0
      const last = snapshot.last_compaction

      const usageCard = h('section', { key: 'usage', style: styles.card }, [
        h('div', { key: 'top', style: styles.usageTop }, [
          h('div', { key: 'main', style: styles.usageMain }, typeof used === 'number'
            ? `${fmt(used)} / ${fmt(budget)}`
            : t('usage.noSession')),
          h('div', {
            key: 'side',
            style: { ...styles.usageMuted, color: over ? 'var(--dsw-alias-state-warn-primary)' : undefined },
          }, typeof used === 'number'
            ? over ? t('usage.over') : t('usage.left', { value: fmt(Math.max(0, budget - used)) })
            : ''),
        ]),
        typeof used === 'number'
          ? h('div', { key: 'bar', style: styles.bar }, h('div', {
            style: {
              width: `${Math.max(0, Math.min(1, ratio)) * 100}%`,
              height: '100%',
              background: over ? 'var(--dsw-alias-state-warn-primary)' : 'var(--dsw-alias-state-success-primary)',
            },
          }))
          : null,
        h('div', { key: 'note', style: styles.note }, [
          typeof modelWindow === 'number' ? h('span', { key: 'w' }, t('usage.window', { value: fmt(modelWindow) })) : null,
          clampedAt !== null && clampedAt !== budget
            ? h('span', { key: 'c' }, ` · ${t('usage.clamped', { value: fmt(clampedAt) })}`)
            : null,
        ]),
      ])

      const budgetCard = h('section', { key: 'budget', style: styles.card }, [
        h('div', { key: 'field' }, [
          h('div', { key: 'row', style: styles.fieldRow }, [
            h('div', { key: 'l' }, [
              h('div', { key: 'n', style: styles.fieldLabel }, t('form.budget')),
              h('div', { key: 'h', style: styles.hint }, t('form.budgetHint')),
            ]),
            h('div', { key: 'i', style: styles.inputWrap }, [
              h('input', {
                key: 'in',
                style: styles.input,
                type: 'number',
                min: 1000,
                step: 1000,
                value: draft.threshold,
                onChange: (event) => setDraft((current) => ({ ...current, threshold: event.target.value })),
              }),
              h('span', { key: 'u', style: styles.note }, t('form.budgetUnit')),
            ]),
          ]),
          h('div', { key: 'presets', style: { ...styles.presets, marginTop: 8 } }, PRESETS.map((value) => h('button', {
            key: value,
            type: 'button',
            style: styles.button,
            onClick: () => setDraft((current) => ({ ...current, threshold: String(value) })),
          }, fmt(value)))),
        ]),
        h('label', { key: 'enabled', style: styles.toggle }, [
          h('input', {
            key: 'i',
            type: 'checkbox',
            checked: draft.enabled,
            onChange: (event) => setDraft((current) => ({ ...current, enabled: event.target.checked })),
          }),
          h('span', { key: 'l' }, t('form.enabled')),
        ]),
        h('details', { key: 'adv' }, [
          h('summary', { key: 's', style: styles.summary }, t('form.advanced')),
          h('div', { key: 'body', style: { display: 'flex', flexDirection: 'column', gap: 10, marginTop: 10 } }, [
            h('div', { key: 'retain', style: styles.fieldRow }, [
              h('div', { key: 'l' }, [
                h('div', { key: 'n', style: styles.fieldLabel }, t('form.retain')),
                h('div', { key: 'h', style: styles.hint }, t('form.retainHint')),
              ]),
              h('div', { key: 'i', style: styles.inputWrap }, [
                h('input', {
                  key: 'in',
                  style: styles.input,
                  type: 'number',
                  min: 0,
                  step: 1000,
                  value: draft.retain,
                  onChange: (event) => setDraft((current) => ({ ...current, retain: event.target.value })),
                }),
                h('span', { key: 'u', style: styles.note }, t('form.budgetUnit')),
              ]),
            ]),
            h('label', { key: 'prune', style: { ...styles.toggle, alignItems: 'flex-start' } }, [
              h('input', {
                key: 'i',
                type: 'checkbox',
                checked: draft.prune,
                onChange: (event) => setDraft((current) => ({ ...current, prune: event.target.checked })),
              }),
              h('span', { key: 't' }, [
                h('div', { key: 'l' }, t('form.prune')),
                h('div', { key: 'h', style: styles.hint }, t('form.pruneHint')),
              ]),
            ]),
          ]),
        ]),
        h('div', { key: 'actions', style: styles.actions }, [
          h('button', { key: 'save', type: 'button', style: styles.primary, disabled: busy !== '', onClick: () => save(false) },
            busy === 'save' ? t('form.saving') : t('form.save')),
          h('button', { key: 'reset', type: 'button', style: styles.button, disabled: busy !== '', onClick: () => save(true) }, t('form.reset')),
          h('button', { key: 'compact', type: 'button', style: styles.button, disabled: busy !== '', onClick: condense },
            busy === 'compact' ? t('form.compacting') : t('form.compact')),
          notice === '' ? null : h('span', { key: 'n', style: styles.note }, notice),
        ]),
        error === '' ? null : h('div', { key: 'err', style: styles.error }, error),
      ])

      const detailsCard = h('details', { key: 'details', style: { ...styles.card, gap: 6 } }, [
        h('summary', { key: 's', style: styles.summary }, t('form.details')),
        h('div', { key: 'c', style: styles.note }, t('form.counters', {
          checks: snapshot.counters.checks,
          compactions: snapshot.counters.compactions,
        })),
        h('div', { key: 'l', style: styles.note }, last === null || last === undefined
          ? t('form.noCompaction')
          : last.tokens_before === null || last.freed_tokens === null
            ? t('form.noCompaction')
            : t('form.lastCompaction', { from: fmt(last.tokens_before), to: fmt(last.tokens_after) })),
        h('div', { key: 'o', style: { ...styles.note, ...styles.mono } }, snapshot.override_active
          ? t('form.override', { path: snapshot.override_path })
          : t('form.overrideNone')),
      ])

      return h('div', { style: styles.page }, [header, usageCard, budgetCard, detailsCard])
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
