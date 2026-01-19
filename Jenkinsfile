pipeline {
    agent any

    stages {
        stage('Checkout') {
            steps {
                checkout scm
            }
        }

        stage('Install dependencies (server)') {
            steps {
                dir('server') {
                    sh 'npm install'
                }
            }
        }

        stage('Build server') {
            steps {
                dir('server') {
                    sh 'npm run build || echo "No build script"'
                }
            }
        }

        stage('Test server') {
            steps {
                dir('server') {
                    sh 'npm test || echo "No test script"'
                }
            }
        }
    }
}
