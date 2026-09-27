import { Link } from 'react-router-dom';
import { useHomeworkItems } from './useHomeworkItems';
import { HomeworkRow } from './HomeworkRow';
import './homework.css';

const HOME_LIMIT = 4;

/**
 * Home: the one-off homework still to do, overdue first, each with its due
 * label. Hidden when nothing is pending. Reads IndexedDB only (offline).
 */
export function HomeworkDueCard() {
  const items = useHomeworkItems();
  if (!items || items.todo.length === 0) return null;
  const overdue = items.todo.filter((i) => i.due.tone === 'overdue').length;
  const tutors = Array.from(new Set(items.todo.map((i) => i.assignment.tutor_name).filter(Boolean)));
  return (
    <section className="card hw-card" aria-label="Homework" data-testid="homework-due-card">
      <div className="hw-card-head">
        <h2>Homework</h2>
        <span className="hw-card-sub">
          {tutors.length === 1 ? `from ${tutors[0]}` : null}
          {overdue > 0 ? <span className="hw-card-overdue"> · {overdue} overdue</span> : null}
        </span>
      </div>
      <div className="hw-list">
        {items.todo.slice(0, HOME_LIMIT).map((item) => (
          <HomeworkRow key={item.assignment.id} item={item} />
        ))}
      </div>
      <Link to="/homework" className="hw-card-all">
        {items.todo.length > HOME_LIMIT ? `All homework (${items.todo.length}) →` : 'All homework →'}
      </Link>
    </section>
  );
}
