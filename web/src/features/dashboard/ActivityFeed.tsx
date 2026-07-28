import type { ActivityEvent } from '../../data/domain'
import { Badge } from '../../components/ui/Badge'

const fixtureNow = Date.parse('2026-07-28T10:42:00+08:00')

function relativeTime(createdAt: string): string {
  const minutes = Math.max(
    0,
    Math.round((fixtureNow - Date.parse(createdAt)) / 60_000),
  )

  if (minutes < 60) {
    return `${minutes} 分钟前`
  }

  const hours = Math.round(minutes / 60)
  return `${hours} 小时前`
}

export function ActivityFeed({
  activities,
}: {
  activities: ActivityEvent[]
}) {
  return (
    <ol className="activity-feed">
      {activities.map((activity) => (
        <li className="activity-feed__item" key={activity.id}>
          <div className="activity-feed__meta">
            <strong>{activity.actor.name}</strong>
            <time dateTime={activity.createdAt}>
              {relativeTime(activity.createdAt)}
            </time>
          </div>
          <p>{activity.action}</p>
          <Badge>{activity.operation}</Badge>
        </li>
      ))}
    </ol>
  )
}
