// @vitest-environment jsdom
/* eslint-disable react/react-in-jsx-scope */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import CaddiePlanCard, { ChatQuickReplyContext, caddieDecisionText, parseCaddiePlan } from './CaddiePlanCard'
import { MarkdownMessage } from '../../ChatInterface'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const plan = {
  batch: 'b-123',
  title: 'Sign off 82618-1',
  workOrder: '82618-1',
  changes: ['Invoice #950: draft to signed off'],
  sends: ['AppFolio on the next hourly run'],
  switches: ['FINALIZE_MODE live'],
  notes: [],
}

let container: HTMLDivElement
let root: Root

afterEach(async () => {
  if (root) await act(async () => root.unmount())
  container?.remove()
})

async function mount(node: React.ReactNode) {
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await act(async () => root.render(node))
}

const button = (name: string) =>
  [...container.querySelectorAll('button')].find((b) => b.textContent === name) as HTMLButtonElement | undefined

describe('parseCaddiePlan', () => {
  it('reads a plan and drops non-string items', () => {
    expect(parseCaddiePlan(JSON.stringify({ ...plan, notes: [1, 'No email'] })))
      .toEqual({ ...plan, notes: ['No email'] })
  })

  it('rejects blocks without a batch or that are not JSON', () => {
    expect(parseCaddiePlan('{"title":"x"}')).toBeNull()
    expect(parseCaddiePlan('not json')).toBeNull()
  })
})

describe('CaddiePlanCard', () => {
  it('sends the confirm reply once and then shows the decision', async () => {
    const send = vi.fn<(text: string) => void>()
    await mount(
      <ChatQuickReplyContext.Provider value={{ send, busy: false }}>
        <CaddiePlanCard plan={plan} />
      </ChatQuickReplyContext.Provider>,
    )
    await act(async () => button('Confirm')!.click())
    expect(send).toHaveBeenCalledWith(caddieDecisionText('confirm', 'b-123'))
    expect(button('Confirm')).toBeUndefined()
    expect(container.textContent).toContain('Confirmed. Caddie is running it.')
  })

  it('disables the buttons while the agent is working', async () => {
    await mount(
      <ChatQuickReplyContext.Provider value={{ send: vi.fn<(text: string) => void>(), busy: true }}>
        <CaddiePlanCard plan={plan} />
      </ChatQuickReplyContext.Provider>,
    )
    expect(button('Cancel')!.disabled).toBe(true)
  })

  it('renders from a caddie-plan code block in a chat message', async () => {
    await mount(<MarkdownMessage message={'Caddie proposes:\n\n```caddie-plan\n' + JSON.stringify(plan) + '\n```'} />)
    expect(container.textContent).toContain('Sign off 82618-1')
    expect(button('Confirm')).toBeDefined()
    expect(container.querySelector('pre')).toBeNull()
  })
})
