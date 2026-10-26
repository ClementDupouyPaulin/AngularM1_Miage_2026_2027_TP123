import { inject, Injectable } from "@angular/core";
import { HttpClient } from "@angular/common/http";
import { Observable } from "rxjs";
import { FriendEntry, FriendsOverview } from "../models/friend.model";

/** Amis et invitations : toute la frontière HTTP est ici. */
@Injectable({ providedIn: "root" })
export class FriendService {
  private readonly http = inject(HttpClient);

  overview(): Observable<FriendsOverview> {
    return this.http.get<FriendsOverview>("/api/friends");
  }

  /** Réponse générique `202` : le serveur ne révèle pas si le compte existe. */
  invite(email: string): Observable<{ message: string }> {
    return this.http.post<{ message: string }>("/api/friends/requests", {
      email,
    });
  }

  accept(requestId: string): Observable<FriendEntry> {
    return this.http.post<FriendEntry>(
      `/api/friends/requests/${requestId}/accept`,
      {},
    );
  }

  /** Refuse, annule ou retire : `204 No Content`. */
  remove(id: string): Observable<void> {
    return this.http.delete<void>(`/api/friends/${id}`);
  }
}
