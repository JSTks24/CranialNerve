export interface RecallCardItem {
  key: string
  timeDeltaText: string
  timeStart: string
  timeEnd: string
  location: string
  summary: string
  keyDialogue: string
}

export interface RecallCardPayload {
  v: 1
  items: RecallCardItem[]
}
