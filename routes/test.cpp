#include <bits/stdc++.h>
using namespace std;

int main(){
    string op;
    getline(cin,op);
    for(auto &i:op){
        if(!(isdigit(i) || isalpha(i))) i=' ';
    }
    stringstream ss(op);
    string s;
    while(ss >> s){
        cout<<s<<" ";
    }
}
