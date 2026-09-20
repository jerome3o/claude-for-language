/**
 * The student picker sheet used by "Send to student" / "Assign" in the
 * review apps. Single mode: one action button per row. Multi mode:
 * checkboxes plus one confirm button.
 */
import type { StudentPick } from '../../../tools/apps/types';
import { avatar, busy, h, openSheet, plural } from './dom';

export interface PickerRow<S extends StudentPick> {
  student: S;
  /** Secondary line under the name ("Already has this deck · 3 new words"). */
  sub?: string;
  /** Button label in single mode (default "Send"). */
  action?: string;
  disabled?: boolean;
}

export interface SinglePickerOptions<S extends StudentPick> {
  title: string;
  rows: PickerRow<S>[];
  emptyText?: string;
  /** Resolve with a message to toast; throw to show an error under the row. */
  onPick: (student: S) => Promise<string | void>;
}

export function pickStudent<S extends StudentPick>(o: SinglePickerOptions<S>): void {
  const sheet = openSheet(o.title);
  if (o.rows.length === 0) {
    sheet.body.appendChild(h('p', { class: 'empty' }, o.emptyText ?? 'No students yet. Invite one from the app first.'));
    return;
  }
  for (const row of o.rows) {
    const status = h('div', { class: 'small', style: 'min-height:0' });
    const btn: HTMLButtonElement = h(
      'button',
      {
        class: 'btn btn-primary btn-sm',
        disabled: row.disabled,
        onclick: () =>
          busy(btn, async () => {
            try {
              const msg = await o.onPick(row.student);
              status.textContent = msg ?? 'Done';
              status.className = 'small';
              status.style.color = 'var(--success)';
              btn.textContent = 'Done';
              btn.disabled = true;
            } catch (err) {
              status.textContent = err instanceof Error ? err.message : String(err);
              status.style.color = 'var(--danger)';
            }
          }),
      },
      row.action ?? 'Send',
    );
    sheet.body.appendChild(
      h(
        'div',
        { class: 'sheet-row' },
        avatar(row.student.name, row.student.picture_url),
        h('div', { class: 'grow' }, h('div', { class: 'bold ellipsis' }, row.student.name), row.sub ? h('div', { class: 'small muted' }, row.sub) : null, status),
        btn,
      ),
    );
  }
}

export interface MultiPickerOptions<S extends StudentPick> {
  title: string;
  rows: PickerRow<S>[];
  confirmLabel: (count: number) => string;
  emptyText?: string;
  onConfirm: (students: S[]) => Promise<string | void>;
}

export function pickStudents<S extends StudentPick>(o: MultiPickerOptions<S>): void {
  const sheet = openSheet(o.title);
  if (o.rows.length === 0) {
    sheet.body.appendChild(h('p', { class: 'empty' }, o.emptyText ?? 'No students yet. Invite one from the app first.'));
    return;
  }
  const chosen = new Set<S>();
  const confirm: HTMLButtonElement = h('button', { class: 'btn btn-primary btn-block', disabled: true }, o.confirmLabel(0));
  const status = h('div', { class: 'small', style: 'margin-top:0.5rem;min-height:1.2em' });
  const refresh = () => {
    confirm.textContent = o.confirmLabel(chosen.size);
    confirm.disabled = chosen.size === 0;
  };
  for (const row of o.rows) {
    const box: HTMLInputElement = h('input', {
      type: 'checkbox',
      disabled: row.disabled,
      onchange: () => {
        if (box.checked) chosen.add(row.student);
        else chosen.delete(row.student);
        refresh();
      },
    });
    sheet.body.appendChild(
      h(
        'label',
        { class: 'sheet-row check' },
        box,
        avatar(row.student.name, row.student.picture_url),
        h('div', { class: 'grow' }, h('div', { class: 'bold ellipsis' }, row.student.name), row.sub ? h('div', { class: 'small muted' }, row.sub) : null),
      ),
    );
  }
  confirm.addEventListener('click', () =>
    busy(confirm, async () => {
      try {
        const msg = await o.onConfirm([...chosen]);
        status.textContent = msg ?? `Done for ${plural(chosen.size, 'student')}.`;
        status.style.color = 'var(--success)';
        setTimeout(sheet.close, 900);
      } catch (err) {
        status.textContent = err instanceof Error ? err.message : String(err);
        status.style.color = 'var(--danger)';
      }
    }),
  );
  sheet.body.appendChild(h('div', { style: 'margin-top:0.75rem' }, confirm, status));
}
