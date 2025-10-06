'use client';

import { useState, useEffect } from 'react';
import { useFirebase, useCollection } from '@/firebase';
import { collection, getDocs, query } from 'firebase/firestore';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Label } from '@/components/ui/label';

type UserProfile = {
  uid: string;
  email: string | null;
};

interface UserSelectionMenuProps {
  onUserSelected: (uid: string | null) => void;
}

export function UserSelectionMenu({ onUserSelected }: UserSelectionMenuProps) {
  const { firestore } = useFirebase();
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedUser, setSelectedUser] = useState<string | null>(null);

  useEffect(() => {
    const fetchUsers = async () => {
      if (!firestore) return;
      setIsLoading(true);
      try {
        const usersCollectionRef = collection(firestore, 'users');
        const userSnapshot = await getDocs(query(usersCollectionRef));
        const userList = userSnapshot.docs.map(doc => ({
          uid: doc.id,
          email: doc.data().email || doc.id,
        }));
        setUsers(userList);
      } catch (error) {
        console.error("Failed to fetch users:", error);
      } finally {
        setIsLoading(false);
      }
    };

    fetchUsers();
  }, [firestore]);

  const handleValueChange = (uid: string) => {
    const userUid = uid === 'none' ? null : uid;
    setSelectedUser(userUid);
    onUserSelected(userUid);
  };

  if (isLoading) {
    return <p>Loading users...</p>;
  }

  return (
    <div className="space-y-2">
      <Label htmlFor="user-selection">Daten anzeigen von:</Label>
      <Select onValueChange={handleValueChange} value={selectedUser || 'none'}>
        <SelectTrigger id="user-selection">
          <SelectValue placeholder="Benutzer auswählen..." />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="none">Eigenen Daten</SelectItem>
          {users.map(user => (
            <SelectItem key={user.uid} value={user.uid}>
              {user.email}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
