pipeline {
    agent any

    environment {
        IMAGE_NAME = "qlhd-server:latest"
        CONTAINER_NAME = "qlhd-server"
        APP_PORT = "3000"
    }

    stages {

        stage('Checkout source') {
            steps {
                checkout scm
            }
        }

        stage('Build Docker image') {
            steps {
                dir('server') {
                    sh 'docker build -t ${IMAGE_NAME} .'
                }
            }
        }

        stage('Run container with env file') {
            steps {
                withCredentials([file(credentialsId: 'git', variable: 'ENV_FILE')]) {
                    sh '''
                    echo "=== Copy env file to workspace ==="
                    cp $ENV_FILE .env

                    docker rm -f ${CONTAINER_NAME} || true

                    docker run -d \
                      --name ${CONTAINER_NAME} \
                      --env-file .env \
                      -p ${APP_PORT}:${APP_PORT} \
                      --restart always \
                      ${IMAGE_NAME}
                    '''
                }
            }
        }
    }

    post {
        always {
            sh 'rm -f .env || true'
        }
        success {
            echo "✅ DEPLOY SUCCESS"
        }
        failure {
            echo "❌ DEPLOY FAILED"
        }
    }
}
