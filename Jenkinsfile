pipeline {
    agent any

    triggers {
        githubPush()
    }

    stages {
        stage('Deploy Backend') {
            steps {
                bat '''
                cd /d D:\\Code\\QLHD\\server
                git pull origin master
                npm install
                pm2 reload ecosystem.config.js
                '''
            }
        }
    }
}
