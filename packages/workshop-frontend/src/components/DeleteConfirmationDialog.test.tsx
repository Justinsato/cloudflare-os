// @vitest-environment jsdom
/* eslint-disable react/react-in-jsx-scope */

import { act } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { makeTestRoot } from '../action-test-harness'
import DeleteConfirmationDialog from './DeleteConfirmationDialog'

const view = makeTestRoot()
afterEach(() => view.cleanup())

function confirmButton() {
  return [...document.querySelectorAll('button')].find((b) => b.textContent === 'Delete')!
}

async function type(value: string) {
  const input = document.querySelector('input[type="text"]') as HTMLInputElement
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
  await act(async () => {
    setter.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

describe('DeleteConfirmationDialog', () => {
  it('keeps Delete disabled until the phrase is typed', async () => {
    const onConfirm = vi.fn()
    await view.render(
      <DeleteConfirmationDialog open title="Delete workspace" description="Delete it?"
        requireTypedConfirmation="delete workspace" onOpenChange={() => {}} onConfirm={onConfirm} />,
    )
    expect(document.body.textContent).toContain('Type delete workspace to confirm.')
    expect(confirmButton().disabled).toBe(true)
    await type('delete')
    expect(confirmButton().disabled).toBe(true)
    await type('  Delete Workspace ')
    expect(confirmButton().disabled).toBe(false)
    await act(async () => confirmButton().click())
    expect(onConfirm).toHaveBeenCalledTimes(1)
  })

  it('needs no typing when no phrase is required', async () => {
    await view.render(
      <DeleteConfirmationDialog open title="Delete file" description="Delete it?"
        onOpenChange={() => {}} onConfirm={() => {}} />,
    )
    expect(document.querySelector('input[type="text"]')).toBeNull()
    expect(confirmButton().disabled).toBe(false)
  })
})
