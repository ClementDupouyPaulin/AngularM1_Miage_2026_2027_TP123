import { inject, Injectable } from "@angular/core";
import { HttpClient, HttpParams } from "@angular/common/http";
import { Observable } from "rxjs";
import { ActivityEvent } from "../models/friend.model";

@Injectable({ providedIn: "root" })
export class ActivityService {
  private readonly http = inject(HttpClient);

  recent(limit = 20): Observable<ActivityEvent[]> {
    return this.http.get<ActivityEvent[]>("/api/activity", {
      params: new HttpParams().set("limit", limit),
    });
  }
}
