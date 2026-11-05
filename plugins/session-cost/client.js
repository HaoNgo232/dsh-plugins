window.__ModuleLoader__.load({
  id: '@local/session-cost',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const NS = 'sessionCost'

    const en = {
      'badge.aria': 'Session cost {amount}, open the cost breakdown',
      'panel.title': 'Session cost',
      'panel.subtitle': 'Estimated from logged token usage',
      'panel.close': 'Close cost breakdown',
      'session.total': 'Session total',
      'session.requests': 'Requests',
      'session.tokens': 'Tokens',
      'session.cacheHit': 'Cache hit',
      'session.models': 'By model',
      'session.tasks': 'Recent tasks',
      'go.title': 'OpenCode Go usage (all sessions, est.)',
      'go.fiveHour': '5-hour window',
      'go.week': 'Weekly window',
      'go.month': 'Monthly window',
      'go.limits': 'This month vs Go limit',
      'go.unlimited': 'no limit',
      'go.unpriced': 'Unpriced: {models}',
      'task.row': 'Task {turn}',
    }

    const vi = {
      'badge.aria': 'Chi phí session {amount}, mở chi tiết',
      'panel.title': 'Chi phí session',
      'panel.subtitle': 'Ước tính từ token đã ghi trong log',
      'panel.close': 'Đóng chi tiết chi phí',
      'session.total': 'Tổng session',
      'session.requests': 'Số request',
      'session.tokens': 'Tokens',
      'session.cacheHit': 'Cache hit',
      'session.models': 'Theo model',
      'session.tasks': 'Task gần đây',
      'go.title': 'Dùng OpenCode Go (tất cả session, ước tính)',
      'go.fiveHour': 'Cửa sổ 5 giờ',
      'go.week': 'Cửa sổ tuần',
      'go.month': 'Cửa sổ tháng',
      'go.limits': 'Tháng này so với hạn mức Go',
      'go.unlimited': 'không giới hạn',
      'go.unpriced': 'Chưa có giá: {models}',
      'task.row': 'Task {turn}',
    }

    function fmtUsd(value) {
      if (!Number.isFinite(value)) return '$0'
      if (value === 0) return '$0'
      if (Math.abs(value) < 0.01) return `$${value.toFixed(4)}`
      if (Math.abs(value) < 1) return `$${value.toFixed(3)}`
      return `$${value.toFixed(2)}`
    }

    function fmtTokens(value) {
      if (value >= 1e6) return `${(value / 1e6).toFixed(2)}M`
      if (value >= 1e3) return `${(value / 1e3).toFixed(1)}k`
      return String(value)
    }

    const badgeStyle = {
      display: 'inline-flex',
      alignItems: 'center',
      gap: 4,
      padding: '0 5px',
      border: 0,
      borderRadius: 6,
      background: 'transparent',
      color: 'var(--dsw-alias-label-secondary)',
      font: 'inherit',
      fontSize: 11,
      lineHeight: '18px',
      cursor: 'pointer',
      fontVariantNumeric: 'tabular-nums',
    }

    const panelStyle = {
      position: 'absolute',
      right: 0,
      bottom: 'calc(100% + 8px)',
      zIndex: 40,
      minWidth: 300,
      maxWidth: 370,
      padding: 12,
      borderRadius: 8,
      border: '1px solid var(--dsw-alias-border-l1)',
      background: 'var(--dsw-alias-bg-overlay)',
      boxShadow: '0 12px 32px rgba(0, 0, 0, 0.35)',
      color: 'var(--dsw-alias-label-primary)',
      fontSize: 12,
      lineHeight: '18px',
      fontVariantNumeric: 'tabular-nums',
    }

    const rowStyle = {
      display: 'flex',
      alignItems: 'baseline',
      justifyContent: 'space-between',
      gap: 12,
      margin: '2px 0',
    }

    const sectionStyle = {
      margin: '10px 0 2px',
      color: 'var(--dsw-alias-label-secondary)',
      fontSize: 10,
      letterSpacing: '0.04em',
      textTransform: 'uppercase',
    }

    function Row({ left, right, muted }) {
      return h('div', { style: rowStyle }, [
        h('span', { key: 'l', style: { color: muted ? 'var(--dsw-alias-label-secondary)' : 'var(--dsw-alias-label-primary)', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, left),
        h('span', { key: 'r', style: { flex: 'none' } }, right),
      ])
    }

    function Bar({ ratio, tone }) {
      const width = Math.max(0, Math.min(1, ratio)) * 100
      return h('div', {
        style: {
          height: 4,
          marginTop: 2,
          borderRadius: 999,
          background: 'var(--dsw-alias-border-l1)',
          overflow: 'hidden',
        },
      }, h('div', {
        style: {
          width: `${width}%`,
          height: '100%',
          background: tone === 'warn' ? 'var(--dsw-alias-state-warn-primary)' : 'var(--dsw-alias-state-success-primary)',
        },
      }))
    }

    function CostPanel({ view, t }) {
      const models = view.models.slice(0, 4)
      const tasks = view.turnsDetail.slice(-5)
      let totalTokens = view.totalTokens
      return h('div', { style: panelStyle, role: 'dialog', 'aria-label': t('panel.title') }, [
        h('div', { key: 'title', style: { display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8, marginBottom: 4 } }, [
          h('strong', { key: 't', style: { fontSize: 12, flex: 'none' } }, t('panel.title')),
          h('span', { key: 's', style: { color: 'var(--dsw-alias-label-secondary)', fontSize: 10, textAlign: 'right' } }, t('panel.subtitle')),
        ]),
        h(Row, { key: 'total', left: t('session.total'), right: fmtUsd(view.totalUsd) }),
        h(Row, { key: 'req', left: t('session.requests'), right: String(view.requests), muted: true }),
        h(Row, { key: 'tok', left: t('session.tokens'), right: fmtTokens(totalTokens), muted: true }),
        h(Row, { key: 'cache', left: t('session.cacheHit'), right: `${Math.round(view.cacheHit * 100)}%`, muted: true }),
        models.length > 0 ? h('div', { key: 'models', style: sectionStyle }, t('session.models')) : null,
        ...models.map((model) => h(Row, { key: `m:${model.model}`, left: model.model, right: `${fmtUsd(model.costUsd)} · ${model.requests}` , muted: true })),
        tasks.length > 1 ? h('div', { key: 'tasks', style: sectionStyle }, t('session.tasks')) : null,
        ...tasks.map((task) => h(Row, {
          key: `t:${task.turn}`,
          left: t('task.row', { turn: task.turn }),
          right: fmtUsd(task.costUsd),
          muted: true,
        })),
        h('div', { key: 'go', style: sectionStyle }, t('go.title')),
        h(Row, { key: '5h', left: t('go.fiveHour'), right: fmtUsd(view.windows.fiveHourUsd), muted: true }),
        h(Row, { key: 'wk', left: t('go.week'), right: fmtUsd(view.windows.weekUsd), muted: true }),
        h(Row, { key: 'mo', left: t('go.month'), right: fmtUsd(view.windows.monthUsd), muted: true }),
        view.monthly.filter((entry) => entry.limitUsd > 0).length > 0
          ? h('div', { key: 'limits', style: sectionStyle }, t('go.limits'))
          : null,
        ...view.monthly
          .filter((entry) => entry.limitUsd > 0)
          .slice(0, 3)
          .map((entry) => h('div', { key: `l:${entry.model}`, style: { margin: '4px 0' } }, [
            h(Row, {
              key: 'row',
              left: entry.model,
              right: `${fmtUsd(entry.costUsd)} / ${fmtUsd(entry.limitUsd)} · ${Math.round(entry.ratio * 100)}%`,
              muted: true,
            }),
            h(Bar, { key: 'bar', ratio: entry.ratio, tone: entry.ratio > 0.8 ? 'warn' : 'ok' }),
          ])),
        view.unpriced.length > 0
          ? h('div', { key: 'unpriced', style: { ...sectionStyle, whiteSpace: 'normal' } }, t('go.unpriced', { models: view.unpriced.join(', ') }))
          : null,
      ])
    }

    function CostControl(props) {
      const view = props.useProjection('sessionCost')
      const t = props.t
      const [open, setOpen] = React.useState(false)
      const rootRef = React.useRef(null)

      React.useEffect(() => {
        if (!open) return undefined
        const onPointerDown = (event) => {
          if (rootRef.current !== null && !rootRef.current.contains(event.target)) setOpen(false)
        }
        const onKeyDown = (event) => {
          if (event.key === 'Escape') setOpen(false)
        }
        document.addEventListener('pointerdown', onPointerDown)
        document.addEventListener('keydown', onKeyDown)
        return () => {
          document.removeEventListener('pointerdown', onPointerDown)
          document.removeEventListener('keydown', onKeyDown)
        }
      }, [open])

      if (view === undefined || view === null || view.totalUsd === undefined || view.requests === 0) return null
      const amount = fmtUsd(view.totalUsd)
      return h('div', { ref: rootRef, style: { position: 'relative', display: 'inline-flex' } }, [
        h('button', {
          key: 'badge',
          type: 'button',
          'data-composer-stat': 'cost',
          style: badgeStyle,
          title: `${t('panel.title')}: ${amount}`,
          'aria-label': t('badge.aria', { amount }),
          'aria-expanded': open,
          onClick: () => setOpen((value) => !value),
        }, `≈${amount}`),
        open ? h(CostPanel, { key: 'panel', view, t }) : null,
      ])
    }

    const inject = ['slots', 'locale']

    function apply(ctx) {
      try {
        ctx.effect(() => ctx.locale.register(NS, { en, vi }), 'session-cost: dictionaries')
      } catch {
        // Locale is cosmetic; the control still renders with English fallbacks.
      }
      ctx.slots.inject('conversation.composer.dock', () => ctx.slots.register({
        name: 'conversation.composer.dock',
        id: 'cost',
        order: 2,
        locale: NS,
      }, CostControl))
    }

    return { inject, apply }
  },
})
