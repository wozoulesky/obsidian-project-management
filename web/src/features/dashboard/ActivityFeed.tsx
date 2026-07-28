import { useSyncExternalStore } from 'react'

import type { ActivityEvent } from '../../data/domain'
import { Badge } from '../../components/ui/Badge'

const subscribeToClock = () => () => {}
const readCurrentMinute = () =>
  Math.floor(Date.now() / 60_000) * 60_000 + 59_999

function relativeTime(createdAt: string, now: number): string {
  const elapsed = now - Date.parse(createdAt)
  if (elapsed < 0) {
    return '稍后'
  }

  const minutes = Math.floor(elapsed / 60_000)
  if (minutes < 1) {
    return '刚刚'
  }
  if (minutes < 60) {
    return `${minutes} 分钟前`
  }

  const hours = Math.floor(minutes / 60)
  if (hours < 24) {
    return `${hours} 小时前`
  }

  return `${Math.floor(hours / 24)} 天前`
}

export function ActivityFeed({
  activities,
  now,
}: {
  activities: ActivityEvent[]
  now?: number
}) {
  const clockNow = useSyncExternalStore(
    subscribeToClock,
    readCurrentMinute,
    readCurrentMinute,
  )
  const renderedAt = now ?? clockNow

  return (
    <ol className="activity-feed">
      {activities.map((activity) => (
        <li className="activity-feed__item" key={activity.id}>
          <div className="activity-feed__meta">
            <strong>{activity.actor.name}</strong>
            <time dateTime={activity.createdAt}>
              {relativeTime(activity.createdAt, renderedAt)}
            </time>
          </div>
          <p>{activity.action}</p>
          <Badge>{activity.operation}</Badge>
        </li>
      ))}
    </ol>
  )
}
