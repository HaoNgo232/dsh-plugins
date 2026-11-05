window.__ModuleLoader__.load({
  id: '@local/auto-compact',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const NS = 'autoCompaction'
    const STATUS_URL = '/auto-compact/status'
    const CONFIG_URL = '/auto-compact/config'

    const en = {
      'nav': 'Compaction',
      'page.title': 'Auto compaction',
      'page.subtitle': 'When a chat gets too long, older turns are summarized so the conversation can keep going.',
      'usage.none': 'No open chat yet.',
      'usage.used': 'used',
      'usage.left': '{value} left',
      'usage.over': 'over the limit — condensing on the next step',
      'field.label': 'Condense when the chat reaches',
      'field.unit': 'tokens',
      'action.save': 'Save',
      'action.saving': 'Saving…',
      'action.saved': 'Saved.',
      'error.load': 'Could not read the current value: {message}',
      'error.save': 'Could not save: {message}',
      'loading': 'Loading…',
    }

    const vi = {
      'nav': 'Nén ngữ cảnh',
      'page.title': 'Tự nén ngữ cảnh',
      'page.subtitle': 'Khi cuộc trò chuyện quá dài, các lượt cũ được tóm tắt để chat tiếp tục được.',
      'usage.none': 'Chưa có chat nào đang mở.',
      'usage.used': 'đã dùng',
      'usage.left': 'còn {value}',
      'usage.over': 'đã vượt ngưỡng — sẽ nén ở bước sau',
      'field.label': 'Nén khi chat đạt',
      'field.unit': 'token',
      'action.save': 'Lưu',
      'action.saving': 'Đang lưu…',
      'action.saved': 'Đã lưu.',
      'error.load': 'Không đọc được giá trị hiện tại: {message}',
      'error.save': 'Không lưu được: {message}',
      'loading': 'Đang tải…',
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
        gap: 12,
        maxWidth: 560,
        color: 'var(--dsw-alias-label-primary)',
        fontSize: 13,
        lineHeight: '20px',
      },
      title: { margin: 0, fontSize: 15, fontWeight: 600 },
      subtitle: { margin: '2px 0 0', color: 'var(--dsw-alias-label-secondary)', fontSize: 12 },
      usage: { display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10, marginTop: 6 },
      usageMain: { fontVariantNumeric: 'tabular-nums' },
      usageSide: { color: 'var(--dsw-alias-label-secondary)', fontSize: 12, fontVariantNumeric: 'tabular-nums' },
      bar: { height: 5, borderRadius: 999, background: 'var(--dsw-alias-border-l1)', overflow: 'hidden' },
      row: { display: 'flex', alignItems: 'center', gap: 8, marginTop: 6, flexWrap: 'wrap' },
      label: { fontSize: 13, marginRight: 2 },
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
      unit: { color: 'var(--dsw-alias-label-secondary)', fontSize: 11 },
      save: {
        padding: '5px 14px',
        borderRadius: 6,
        border: '1px solid var(--dsw-alias-state-success-primary, currentColor)',
        background: 'var(--dsw-alias-state-success-primary, transparent)',
        color: 'var(--dsw-alias-bg-l1, #fff)',
        font: 'inherit',
        cursor: 'pointer',
      },
      note: { color: 'var(--dsw-alias-label-secondary)', fontSize: 11 },
      error: { color: 'var(--dsw-alias-state-error-primary, crimson)', fontSize: 12 },
    }

    function CompactionSection(props) {
      const t = props.t
      const [snapshot, setSnapshot] = React.useState(null)
      const [value, setValue] = React.useState('')
      const [busy, setBusy] = React.useState(false)
      const [notice, setNotice] = React.useState('')
      const [error, setError] = React.useState('')

      const load = React.useCallback(() => {
        setError('')
        fetch(STATUS_URL, { cache: 'no-store' })
          .then((response) => {
            if (!response.ok) throw new Error(`HTTP ${response.status}`)
            return response.json()
          })
          .then((data) => {
            setSnapshot(data)
            setValue(String(data.config.threshold_tokens))
          })
          .catch((cause) => setError(t('error.load', { message: cause instanceof Error ? cause.message : String(cause) })))
      }, [t])

      React.useEffect(() => {
        load()
      }, [load])

      const save = () => {
        setBusy(true)
        setNotice('')
        setError('')
        fetch(CONFIG_URL, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ thresholdTokens: Number(value) }),
          cache: 'no-store',
        })
          .then(async (response) => {
            const payload = await response.json()
            if (!response.ok) throw new Error(payload?.error ?? `HTTP ${response.status}`)
            setSnapshot(payload)
            setValue(String(payload.config.threshold_tokens))
            setNotice(t('action.saved'))
          })
          .catch((cause) => setError(t('error.save', { message: cause instanceof Error ? cause.message : String(cause) })))
          .finally(() => setBusy(false))
      }

      const header = [
        h('h2', { key: 't', style: styles.title }, t('page.title')),
        h('p', { key: 's', style: styles.subtitle }, t('page.subtitle')),
      ]

      if (snapshot === null) {
        return h('div', { style: styles.page }, [
          ...header,
          error === '' ? h('div', { key: 'l', style: styles.note }, t('loading')) : h('div', { key: 'e', style: styles.error }, error),
        ])
      }

      const used = snapshot.pressure_tokens
      const budget = Number.isFinite(Number(value)) && Number(value) > 0 ? Number(value) : snapshot.config.threshold_tokens
      const over = typeof used === 'number' && used >= budget
      const ratio = typeof used === 'number' && budget > 0 ? used / budget : 0

      return h('div', { style: styles.page }, [
        ...header,
        h('div', { key: 'usage', style: { display: 'flex', flexDirection: 'column', gap: 4 } }, [
          h('div', { key: 'top', style: styles.usage }, [
            h('span', { key: 'u', style: styles.usageMain }, typeof used === 'number'
              ? `${fmt(used)} / ${fmt(budget)} ${t('usage.used')}`
              : t('usage.none')),
            h('span', {
              key: 's',
              style: { ...styles.usageSide, color: over ? 'var(--dsw-alias-state-warn-primary)' : undefined },
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
        ]),
        h('div', { key: 'row', style: styles.row }, [
          h('span', { key: 'l', style: styles.label }, t('field.label')),
          h('input', {
            key: 'i',
            style: styles.input,
            type: 'number',
            min: 1000,
            step: 1000,
            value,
            onChange: (event) => {
              setValue(event.target.value)
              setNotice('')
            },
            onKeyDown: (event) => {
              if (event.key === 'Enter') save()
            },
          }),
          h('span', { key: 'u', style: styles.unit }, t('field.unit')),
          h('button', {
            key: 'b',
            type: 'button',
            style: styles.save,
            disabled: busy,
            onClick: save,
          }, busy ? t('action.saving') : t('action.save')),
          notice === '' ? null : h('span', { key: 'n', style: styles.note }, notice),
        ]),
        error === '' ? null : h('div', { key: 'e', style: styles.error }, error),
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
