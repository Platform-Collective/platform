import type { AccountUuid, MeasureContext, WorkspaceUuid } from '@hcengineering/core'

export enum QueueTopic {
  // Topic with partitions to split workspace transactions into
  Tx = 'tx',

  // Topic to send workspace information into
  Workspace = 'workspace',

  // A fulltext topic to hold extra fulltext request, like re-indexing requests etc, private to fulltext service.
  Fulltext = 'fulltext',

  // A topic about user activity.
  Users = 'users',

  TelegramBot = 'telegramBot',

  // A topic about calendar events.
  CalendarEventCUD = 'calendarEventCUD',

  // A topic about process events
  Process = 'process',

  TimeMachine = 'timeMachine',

  // Queue for AI requests
  AIQueue = 'ai-queue',

  // Queue for audio transcription tasks
  TranscriptionQueue = 'transcription-queue',

  // All OTP and notifications to mail/notify services are goes here first
  // And services will take them and send to a proper places.
  NotificationQueue = 'notifications',

  // Events about meetings and operations with meetings
  LoveQueue = 'love-queue',

  // Cross-workspace unread notification flags. The notification trigger publishes
  // the receivers of freshly created notifications here; account-service consumes
  // the topic and raises workspace_members.has_unread in bulk, instead of the
  // trigger issuing one account RPC per receiver.
  WorkspaceMemberUnread = 'workspace-member-unread'
}

/**
 * Payload of a {@link QueueTopic.WorkspaceMemberUnread} message. The workspace is
 * carried by the queue envelope ({@link ConsumerMessage.workspace}); `accounts`
 * are the members that just gained an unread notification in that workspace.
 */
export interface WorkspaceMemberUnreadMessage {
  accounts: AccountUuid[]
}

export interface ConsumerHandle {
  close: () => Promise<void>
  isConnected: () => boolean
}

export interface ConsumerMessage<T> {
  workspace: WorkspaceUuid
  value: T
}

export interface ConsumerControl {
  pause: () => void
  heartbeat: () => Promise<void>
}

export interface PlatformQueue {
  getProducer: <T>(ctx: MeasureContext, topic: QueueTopic | string) => PlatformQueueProducer<T>

  /**
   * Create a consumer for a topic.
   * return a function to close the reciever.
   */
  createConsumer: <T>(
    ctx: MeasureContext,
    topic: QueueTopic | string,
    groupId: string,
    onMessage: (ctx: MeasureContext, msg: ConsumerMessage<T>, queue: ConsumerControl) => Promise<void>,
    options?: {
      fromBegining?: boolean
      retryDelay?: number // Initial retry delay in milliseconds (default 1000)
      maxRetryDelay?: number // Maximum retry delay in seconds (default 10)
    }
  ) => ConsumerHandle

  createTopic: (topics: string | string[], partitions: number) => Promise<void>

  createTopics: (tx: number) => Promise<void>

  // If not passed will delete all topica from QueueTopic enum
  deleteTopics: (topics?: (QueueTopic | string)[]) => Promise<void>

  getClientId: () => string

  // Will close all producers and consumers
  shutdown: () => Promise<void>
}

/**
 * Create a producer for a topic.
 */
export interface PlatformQueueProducer<T> {
  send: (ctx: MeasureContext, workspace: WorkspaceUuid, msgs: T[], partitionKey?: string) => Promise<void>
  close: () => Promise<void>

  getQueue: () => PlatformQueue
}
